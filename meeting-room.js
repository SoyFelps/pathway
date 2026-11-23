/* Nellio meeting room – the swappable layer (plano-reunioes.md; born in the Phase 0 lab, tested on Windows, Android, iPhone, 4G/5G and a company network).
   Video and audio go straight between the browsers (WebRTC "mesh": every person sends to every other person, fine for 2 to 4 people).
   The signalling (people finding each other and exchanging connection data) goes through a Supabase Realtime channel: no video passes through our servers.
   The page only talks to this module: join, leave, microphone, camera, people. If one day a provider is needed, only this file changes.

   Lessons from others built in from the start:
   - "Perfect negotiation" (MDN): two people joining at the same moment never deadlock; one side is "polite" and gives way.
   - ICE candidates that arrive before the offer/answer are kept and added later.
   - Echo cancellation and noise suppression on; the page asks for camera/microphone only after a click (Safari/iPhone rule). */
(function (root) {
  const MAX_PEOPLE = 4;
  const randomId = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2));

  function createRoom(options) {
    const { supabase, channelName, name, iceServers } = options;
    const emit = (event, detail) => { try { options.on && options.on(event, detail); } catch (error) { console.error(error); } };
    const log = (text) => emit('log', { at: new Date(), text });
    const myId = randomId();
    const peers = new Map(); // id -> { id, name, pc, stream, polite, makingOffer, ignoreOffer, pending: [], joinedAt, connectedAt, stats }
    let channel = null;
    let localStream = null;
    let left = false;

    // Every message is checked: the Realtime client throttles bursts, and a lost offer leaves a connection stuck in "new".
    const send = async (to, payload) => {
      if (!channel) return;
      const result = await channel.send({ type: 'broadcast', event: 'signal', payload: { from: myId, name, to, ...payload } }).catch(error => 'error ' + error.message);
      if (result !== 'ok') log('send ' + (payload.description ? payload.description.type : 'candidates') + ' -> ' + result);
    };
    // ICE candidates arrive in bursts: they go in small batches so the channel is not flooded.
    const queueCandidate = (peer, candidate) => {
      peer.outbox.push(candidate);
      if (!peer.flushTimer) peer.flushTimer = setTimeout(() => { peer.flushTimer = null; const batch = peer.outbox.splice(0); if (batch.length) send(peer.id, { candidates: batch }); }, 250);
    };
    const sendDescription = (peer) => { log('send ' + peer.pc.localDescription.type + ' to ' + peer.name); return send(peer.id, { description: peer.pc.localDescription.toJSON() }); };

    function peerFor(id, peerName) {
      let peer = peers.get(id);
      if (peer) { if (peerName) peer.name = peerName; return peer; }
      const pc = new RTCPeerConnection({ iceServers, iceTransportPolicy: options.relayOnly ? 'relay' : 'all' });
      peer = { id, name: peerName || '?', pc, stream: new MediaStream(), polite: myId > id, makingOffer: false, ignoreOffer: false, pending: [], outbox: [], flushTimer: null, retries: 0, joinedAt: Date.now(), connectedAt: null, candidateType: null };
      peers.set(id, peer);
      if (localStream) for (const track of localStream.getTracks()) pc.addTrack(track, localStream);
      else { pc.addTransceiver('audio', { direction: 'recvonly' }); pc.addTransceiver('video', { direction: 'recvonly' }); }
      pc.ontrack = ({ track }) => {
        peer.stream.addTrack(track);
        // A phone that locks its screen stops sending its camera: the track goes "muted" until it comes back.
        track.onmute = () => log(peer.name + ': ' + track.kind + ' paused');
        track.onunmute = () => log(peer.name + ': ' + track.kind + ' back');
        emit('peers', list());
      };
      pc.onicecandidate = ({ candidate }) => { if (candidate) queueCandidate(peer, candidate.toJSON()); };
      pc.onnegotiationneeded = async () => {
        try {
          peer.makingOffer = true;
          await pc.setLocalDescription();
          await sendDescription(peer);
        } catch (error) { log('negotiation error with ' + peer.name + ': ' + error.message); }
        finally { peer.makingOffer = false; }
      };
      pc.onconnectionstatechange = async () => {
        log(peer.name + ': ' + pc.connectionState);
        if (pc.connectionState === 'connected' && !peer.connectedAt) { peer.connectedAt = Date.now(); peer.candidateType = await selectedCandidateType(pc); await capVideo(peer); }
        if (pc.connectionState === 'failed') pc.restartIce();
        emit('peers', list());
      };
      log('new peer ' + peer.name + (peer.polite ? ' (polite)' : ' (impolite)'));
      // Safety net: if nothing came back, send our side again (a message can be lost); after 3 tries, restart the connection attempt.
      const watchdog = () => {
        if (!peers.has(id) || left || pc.connectionState === 'connected') return;
        if (peer.retries++ >= 3) { log('still not connected to ' + peer.name + ': restarting'); peer.retries = 0; pc.restartIce(); }
        else if (pc.localDescription && pc.signalingState === 'have-local-offer') sendDescription(peer);
        else if (!pc.localDescription && !peer.polite) pc.onnegotiationneeded();
        peer.watchdog = setTimeout(watchdog, 4000);
      };
      peer.watchdog = setTimeout(watchdog, 4000);
      return peer;
    }

    async function onSignal({ from, to, description, candidate, candidates, name: fromName }) {
      if (to !== myId || left) return;
      if (description) log('got ' + description.type + ' from ' + (fromName || from));
      const peer = peerFor(from, fromName);
      const pc = peer.pc;
      try {
        if (description) {
          const collision = description.type === 'offer' && (peer.makingOffer || pc.signalingState !== 'stable');
          peer.ignoreOffer = !peer.polite && collision;
          if (peer.ignoreOffer) { log('ignored a colliding offer from ' + peer.name); return; }
          await pc.setRemoteDescription(description);
          for (const queued of peer.pending.splice(0)) await pc.addIceCandidate(queued).catch(() => {});
          if (description.type === 'offer') {
            await pc.setLocalDescription();
            await sendDescription(peer);
          }
        } else {
          for (const item of candidates || (candidate ? [candidate] : [])) {
            if (!pc.remoteDescription) { peer.pending.push(item); continue; }
            try { await pc.addIceCandidate(item); } catch (error) { if (!peer.ignoreOffer) log('candidate error: ' + error.message); }
          }
        }
      } catch (error) { log('signal error with ' + peer.name + ': ' + error.message); }
    }

    // A ceiling on the video sent (phones on 4G have little upload: sending more than fits makes a queue and seconds of delay).
    async function capVideo(peer) {
      if (!options.videoMaxBitrate) return;
      for (const sender of peer.pc.getSenders()) {
        if (!sender.track || sender.track.kind !== 'video') continue;
        const params = sender.getParameters();
        if (!params.encodings || !params.encodings.length) params.encodings = [{}];
        params.encodings[0].maxBitrate = options.videoMaxBitrate;
        await sender.setParameters(params).then(() => log('video capped at ' + Math.round(options.videoMaxBitrate / 1000) + ' kbps for ' + peer.name)).catch(error => log('video cap: ' + error.message));
      }
    }

    function dropPeer(id) {
      const peer = peers.get(id);
      if (!peer) return;
      clearTimeout(peer.watchdog); clearTimeout(peer.flushTimer);
      try { peer.pc.close(); } catch {}
      peers.delete(id);
      log(peer.name + ' left');
      emit('peers', list());
    }

    function list() {
      return [...peers.values()].map(peer => ({ id: peer.id, name: peer.name, stream: peer.stream, state: peer.pc.connectionState, candidateType: peer.candidateType, connectMs: peer.connectedAt ? peer.connectedAt - peer.joinedAt : null }));
    }

    async function join(stream) {
      localStream = stream || null;
      channel = supabase.channel(channelName, { config: { broadcast: { self: false }, presence: { key: myId } } });
      channel.on('broadcast', { event: 'signal' }, ({ payload }) => onSignal(payload));
      channel.on('presence', { event: 'sync' }, () => {
        const state = channel.presenceState();
        const present = Object.entries(state).map(([id, metas]) => ({ id, name: (metas[0] && metas[0].name) || '?', at: (metas[0] && metas[0].at) || 0 }));
        // Room full: the four who arrived first stay; a fifth leaves on its own.
        const ordered = present.slice().sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : 1));
        if (ordered.length > MAX_PEOPLE && ordered.findIndex(item => item.id === myId) >= MAX_PEOPLE) { emit('full'); leave(); return; }
        for (const person of present) if (person.id !== myId) peerFor(person.id, person.name);
        for (const id of [...peers.keys()]) if (!state[id]) dropPeer(id);
        emit('peers', list());
      });
      await new Promise((resolve, reject) => {
        channel.subscribe(async (status) => {
          log('channel: ' + status);
          if (status === 'SUBSCRIBED') { await channel.track({ name, at: Date.now() }); resolve(); }
          else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') reject(new Error('Could not reach the room (' + status + ').'));
        });
      });
    }

    function leave() {
      if (left) return;
      left = true;
      for (const id of [...peers.keys()]) dropPeer(id);
      if (channel) { channel.untrack().catch(() => {}); supabase.removeChannel(channel); channel = null; }
      if (localStream) for (const track of localStream.getTracks()) track.stop();
      emit('left');
    }

    // New camera/microphone (for example after the phone screen was locked): swapped in every connection without renegotiating.
    async function replaceStream(stream) {
      const old = localStream;
      localStream = stream;
      for (const peer of peers.values()) for (const sender of peer.pc.getSenders()) {
        const track = sender.track ? stream.getTracks().find(item => item.kind === sender.track.kind) : null;
        if (track) await sender.replaceTrack(track).catch(error => log('replace ' + track.kind + ': ' + error.message));
      }
      if (old && old !== stream) for (const track of old.getTracks()) if (!stream.getTracks().includes(track)) track.stop();
    }

    const setTrack = (kind, on) => { if (localStream) for (const track of localStream.getTracks()) if (track.kind === kind) track.enabled = on; };

    return { id: myId, join, leave, replaceStream, localStream: () => localStream, setMic: on => setTrack('audio', on), setCam: on => setTrack('video', on), peers: list, stats: () => Promise.all([...peers.values()].map(async peer => ({ name: peer.name, ...(await pairStats(peer.pc)) }))) };
  }

  // Which path the connection took: host (same network), srflx (straight through the internet), relay (through TURN).
  async function selectedCandidateType(pc) { return (await pairStats(pc)).localType; }
  async function pairStats(pc) {
    const report = await pc.getStats();
    let pair = null;
    report.forEach(item => { if (item.type === 'transport' && item.selectedCandidatePairId) pair = report.get(item.selectedCandidatePairId); });
    if (!pair) report.forEach(item => { if (item.type === 'candidate-pair' && item.nominated && item.state === 'succeeded') pair = item; });
    if (!pair) return { localType: null, remoteType: null, rttMs: null };
    const local = report.get(pair.localCandidateId), remote = report.get(pair.remoteCandidateId);
    return { localType: local && local.candidateType, remoteType: remote && remote.candidateType, protocol: local && local.protocol, rttMs: pair.currentRoundTripTime != null ? Math.round(pair.currentRoundTripTime * 1000) : null };
  }

  root.NellioRoom = { createRoom, MAX_PEOPLE };
})(window);
