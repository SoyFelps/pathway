/* Pathway shared flow utilities — static, no build step. */
(function () {
  const STORAGE_KEY = 'pathway:flows:v1';
  const ANSWERS_KEY = 'pathway:demo-submissions:v1';
  const REQUIRED_FIELDS = ['name', 'email', 'resume'];
  const OPTIONAL_FIELDS = [
    { key: 'phone', label: 'Phone number', type: 'phone' },
    { key: 'country', label: 'Country of birth', type: 'country' },
    { key: 'city', label: 'Current location', type: 'city' },
    { key: 'linkedin', label: 'LinkedIn profile', type: 'url' },
    { key: 'portfolio', label: 'Portfolio website', type: 'url' },
    { key: 'pronouns', label: 'Pronouns', type: 'pronouns' },
    // Not a field of the first page: it adds a second, voluntary page (gender identity, sexual orientation, race and ethnicity, disability).
    { key: 'diversity', label: 'Diversity questions', type: 'diversity', hint: 'A second, voluntary page' }
  ];
  // Details that employers can no longer ask for but that older applications may still hold: kept readable in the candidate panel.
  const LEGACY_FIELD_LABELS = { address: 'Address', workAuthorization: 'Work authorization', currentCountry: 'Current country' };
  const infoFieldLabel = key => (OPTIONAL_FIELDS.find(field => field.key === key) || {}).label || LEGACY_FIELD_LABELS[key] || key;
  const FIELD_META = {
    name: { label: 'Full name', type: 'text', autocomplete: 'name' },
    email: { label: 'Email address', type: 'email', autocomplete: 'email' },
    resume: { label: 'Resume', type: 'file', accept: '.pdf,.doc,.docx' }
  };

  const clone = value => JSON.parse(JSON.stringify(value));
  const uid = prefix => `${prefix || 'id'}-${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36).slice(-4)}`;
  const esc = value => String(value == null ? '' : value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  function isDigitsOnlyAnswer(value) {
    if (typeof value !== 'string') return false;
    return /^[0-9]+$/.test(value);
  }

  function createNode(type, x, y) {
    const base = { id: uid(type), type, x: Math.max(24, x || 0), y: Math.max(24, y || 0), label: '', options: [] };
    if (type === 'candidateInfo') base.label = 'Your details';
    if (type === 'shortText') { base.label = 'A question for your candidate'; base.numericOnly = false; }
    if (type === 'singleChoice') { base.label = 'Choose one option'; base.options = ['Option one', 'Option two']; }
    if (type === 'multiChoice') { base.label = 'Select all that apply'; base.options = ['Option one', 'Option two']; }
    if (type === 'end') { base.label = 'Application received'; base.subtype = 'submitted'; }
    return base;
  }

  // Minimum structure a job needs for the editor and the public page (the database enforces the same rule).
  // A job that fails it is shown as "incomplete" and locked instead of breaking the dashboard.
  const FLOW_NODE_TYPES = ['candidateInfo', 'shortText', 'singleChoice', 'multiChoice', 'end'];
  function flowIsUsable(flow) {
    if (!flow || typeof flow !== 'object') return false;
    const { nodes, edges } = flow;
    if (!Array.isArray(nodes) || !Array.isArray(edges) || nodes.length < 2 || nodes.length > 200 || edges.length > 400) return false;
    const ids = new Set();
    let info = 0;
    let end = 0;
    for (const node of nodes) {
      if (!node || typeof node !== 'object' || typeof node.id !== 'string' || typeof node.type !== 'string') return false;
      if (!FLOW_NODE_TYPES.includes(node.type) || ids.has(node.id)) return false;
      ids.add(node.id);
      if (node.type === 'candidateInfo') info += 1;
      if (node.type === 'end') end += 1;
      if ((node.type === 'singleChoice' || node.type === 'multiChoice') && !Array.isArray(node.options)) return false;
    }
    if (info !== 1 || end < 1) return false;
    return edges.every(edge => edge && typeof edge === 'object' && typeof edge.fromNodeId === 'string' && typeof edge.toNodeId === 'string' && ids.has(edge.fromNodeId) && ids.has(edge.toNodeId));
  }

  function createFlow(companyName, jobTitle, jobDescription) {
    const candidate = createNode('candidateInfo', 72, 250);
    const end = createNode('end', 1140, 270);
    return {
      id: uid('flow'), companyName: companyName || 'Your company', jobTitle: jobTitle || 'Untitled role',
      jobDescription: jobDescription || '', companyId: null, companyProfile: null, publicationStatus: 'draft', activePublishedFlowId: null, candidateInfoFields: Object.fromEntries(OPTIONAL_FIELDS.map(field => [field.key, false])),
      nodes: [candidate, end], edges: [{ id: uid('edge'), fromNodeId: candidate.id, toNodeId: end.id }], updatedAt: new Date().toISOString()
    };
  }

  function createSampleFlow() {
    const flow = createFlow('Northstar Studio', 'Senior Product Designer', 'Help shape thoughtful, human-centered tools for the next generation of work. You’ll partner closely with product and engineering to turn complex ideas into clear, useful experiences.');
    flow.candidateInfoFields = { ...flow.candidateInfoFields, phone: true, country: true, linkedin: true, portfolio: true };
    const candidate = flow.nodes[0];
    const done = flow.nodes[1];
    candidate.x = 72; candidate.y = 285;
    done.x = 1435; done.y = 270;
    const why = createNode('shortText', 405, 170);
    why.label = 'What draws you to designing thoughtful products?';
    const ai = createNode('singleChoice', 745, 220);
    ai.label = 'Have you designed products with AI features?';
    ai.options = ['Yes, in production', 'I’m exploring the space'];
    const craft = createNode('multiChoice', 1090, 115);
    craft.label = 'Which parts of the product process do you enjoy most?';
    craft.options = ['Discovery & research', 'Prototyping', 'Design systems', 'Working with engineers'];
    const curious = createNode('shortText', 1090, 495);
    curious.label = 'What are you most curious about in AI?';
    const endAlt = createNode('end', 1435, 535);
    endAlt.label = 'Thanks for sharing'; endAlt.subtype = 'submitted';
    flow.nodes.push(why, ai, craft, curious, endAlt);
    flow.edges = [
      { id: uid('edge'), fromNodeId: candidate.id, toNodeId: why.id },
      { id: uid('edge'), fromNodeId: why.id, toNodeId: ai.id },
      { id: uid('edge'), fromNodeId: ai.id, toNodeId: craft.id, optionValue: ai.options[0] },
      { id: uid('edge'), fromNodeId: ai.id, toNodeId: curious.id, optionValue: ai.options[1] },
      { id: uid('edge'), fromNodeId: craft.id, toNodeId: done.id },
      { id: uid('edge'), fromNodeId: curious.id, toNodeId: endAlt.id }
    ];
    return flow;
  }

  function normalizeFlow(flow) {
    if (!flow || typeof flow !== 'object') throw new Error('This link does not contain a flow.');
    const normalized = clone(flow);
    normalized.companyId = typeof normalized.companyId === 'string' && normalized.companyId.length <= 80 ? normalized.companyId : null;
    if (normalized.companyProfile && typeof normalized.companyProfile === 'object' && !Array.isArray(normalized.companyProfile)) {
      const profile = normalized.companyProfile;
      const profileId = typeof profile.id === 'string' ? profile.id.slice(0, 80) : '';
      const name = typeof profile.name === 'string' ? profile.name.trim().slice(0, 120) : '';
      const logoPath = typeof profile.logoPath === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/logo(?:-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})?\.(?:png|jpg|webp)$/i.test(profile.logoPath)
        ? profile.logoPath
        : '';
      normalized.companyProfile = profileId && name && (!normalized.companyId || normalized.companyId === profileId)
        ? { id: profileId, name, description: typeof profile.description === 'string' ? profile.description.slice(0, 3000) : '', ...(logoPath ? { logoPath } : {}), logoUrl: typeof profile.logoUrl === 'string' ? profile.logoUrl.slice(0, 2048) : '' }
        : null;
      if (normalized.companyProfile && !normalized.companyId) normalized.companyId = profileId;
    } else normalized.companyProfile = null;
    normalized.candidateInfoFields = normalized.candidateInfoFields || {};
    OPTIONAL_FIELDS.forEach(field => { normalized.candidateInfoFields[field.key] = Boolean(normalized.candidateInfoFields[field.key]); });
    normalized.nodes = Array.isArray(normalized.nodes) ? normalized.nodes : [];
    normalized.edges = Array.isArray(normalized.edges) ? normalized.edges : [];
    normalized.nodes.forEach(node => { if (node.type === 'shortText') node.numericOnly = Boolean(node.numericOnly); });
    // Auto-fail rules (the employer's private screening): only well-formed ones are kept.
    normalized.nodes.forEach(node => {
      if (node.type === 'singleChoice' || node.type === 'multiChoice') {
        const options = Array.isArray(node.options) ? node.options.map(String) : [];
        const flagged = Array.isArray(node.autoFailOptions) ? [...new Set(node.autoFailOptions.map(String).filter(option => options.includes(option)))] : [];
        if (flagged.length) node.autoFailOptions = flagged; else delete node.autoFailOptions;
        delete node.autoFailBelow;
      } else if (node.type === 'shortText') {
        const below = Number(node.autoFailBelow);
        if (node.numericOnly && node.autoFailBelow !== null && node.autoFailBelow !== '' && Number.isInteger(below) && below >= 0 && below <= 1e9) node.autoFailBelow = below; else delete node.autoFailBelow;
        delete node.autoFailOptions;
      } else { delete node.autoFailOptions; delete node.autoFailBelow; }
    });
    const mandatory = normalized.nodes.filter(node => node.type === 'candidateInfo');
    if (mandatory.length !== 1) throw new Error('A flow must contain one candidate information step.');
    if (normalized.nodes.length < 2) throw new Error('This flow is incomplete.');
    const ids = new Set(normalized.nodes.map(node => node.id));
    if (ids.size !== normalized.nodes.length || normalized.edges.some(edge => !ids.has(edge.fromNodeId) || !ids.has(edge.toNodeId))) throw new Error('Some steps or connections are invalid.');
    if (normalized.edges.some(edge => edge.fromNodeId === edge.toNodeId)) throw new Error('A step cannot connect to itself.');
    const info = mandatory[0];
    if (normalized.edges.some(edge => edge.toNodeId === info.id) || normalized.edges.filter(edge => edge.fromNodeId === info.id).length !== 1) throw new Error('The candidate details step must be the start of the flow.');
    const supportedTypes = new Set(['candidateInfo', 'shortText', 'singleChoice', 'multiChoice', 'end']);
    if (normalized.nodes.some(node => !supportedTypes.has(node.type))) throw new Error('This flow contains an unsupported step type.');
    normalized.nodes.forEach(node => {
      const outgoing = normalized.edges.filter(edge => edge.fromNodeId === node.id);
      if (node.type === 'end' && outgoing.length) throw new Error('End steps cannot have outgoing connections.');
      if (node.type !== 'end' && node.type !== 'singleChoice' && outgoing.length !== 1) throw new Error('Every step needs exactly one next connection.');
      if (node.type === 'singleChoice') {
        if (!node.options || node.options.length < 2 || new Set(node.options).size !== node.options.length || node.options.some(option => outgoing.filter(edge => edge.optionValue === option).length !== 1)) throw new Error('Every answer in a single-choice question needs exactly one path.');
        if (outgoing.length !== node.options.length || outgoing.some(edge => !node.options.includes(edge.optionValue))) throw new Error('A connection uses an answer that no longer exists.');
      }
    });
    const reachable = new Set();
    const stack = [info.id];
    while (stack.length) {
      const id = stack.pop();
      if (reachable.has(id)) continue;
      reachable.add(id);
      normalized.edges.filter(edge => edge.fromNodeId === id).forEach(edge => stack.push(edge.toNodeId));
    }
    if (normalized.nodes.some(node => !reachable.has(node.id))) throw new Error('Connect every step to the candidate journey before publishing.');
    if (!normalized.nodes.some(node => node.type === 'end' && reachable.has(node.id))) throw new Error('Add an end step to complete the candidate journey.');
    const active = new Set(), visited = new Set();
    function detectCycle(id) {
      if (active.has(id)) return true;
      if (visited.has(id)) return false;
      active.add(id);
      for (const edge of normalized.edges.filter(item => item.fromNodeId === id)) if (detectCycle(edge.toNodeId)) return true;
      active.delete(id); visited.add(id); return false;
    }
    if (detectCycle(info.id)) throw new Error('This journey contains a loop. Connect each answer to a later step.');
    return normalized;
  }

  function nextNode(flow, node, answer) {
    const outgoing = flow.edges.filter(edge => edge.fromNodeId === node.id);
    let edge;
    if (node.type === 'singleChoice') edge = outgoing.find(item => item.optionValue === answer);
    else edge = outgoing.find(item => !item.optionValue) || outgoing[0];
    return edge ? flow.nodes.find(item => item.id === edge.toNodeId) || null : null;
  }

  function startAfterInfo(flow) {
    const info = flow.nodes.find(node => node.type === 'candidateInfo');
    return info ? nextNode(flow, info, null) : null;
  }

  async function encodeFlow(flow) {
    const bytes = new TextEncoder().encode(JSON.stringify(normalizeFlow(flow)));
    if (typeof CompressionStream !== 'undefined') {
      try {
        const compressed = await new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate'))).arrayBuffer();
        return 'z.' + toBase64Url(new Uint8Array(compressed));
      } catch (_) { /* older browser: use the interoperable plain encoding below */ }
    }
    return 'j.' + toBase64Url(bytes);
  }

  async function decodeFlow(encoded) {
    if (!encoded) throw new Error('This link is missing its flow data.');
    const kind = encoded.slice(0, 2);
    if (kind !== 'z.' && kind !== 'j.') throw new Error('This link format is not recognized.');
    const bytes = fromBase64Url(encoded.slice(2));
    let decodedBytes = bytes;
    if (kind === 'z.') {
      if (typeof DecompressionStream === 'undefined') throw new Error('This browser cannot open the compressed application link.');
      decodedBytes = new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate'))).arrayBuffer());
    } else if (kind !== 'j.') throw new Error('This link format is not recognized.');
    return normalizeFlow(JSON.parse(new TextDecoder().decode(decodedBytes)));
  }

  function toBase64Url(bytes) {
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  }
  function fromBase64Url(value) {
    const base64 = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4);
    const binary = atob(base64);
    return Uint8Array.from(binary, char => char.charCodeAt(0));
  }

  function saveFlows(flows) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(flows)); return true; }
    catch (error) { console.warn('Pathway could not save drafts in this browser.', error); return false; }
  }
  // One candidate per job and e-mail address: repeat applications from the same address to the same job share a single card.
  function candidateKey(applicant) {
    return `${applicant.flow_id}|${String(applicant.candidate_email || '').trim().toLowerCase()}`;
  }
  function groupApplicants(list) {
    const time = applicant => { const value = Date.parse(applicant.submitted_at); return Number.isNaN(value) ? 0 : value; };
    const groups = new Map();
    for (const applicant of list || []) {
      const key = candidateKey(applicant);
      if (!groups.has(key)) groups.set(key, { key, items: [] });
      groups.get(key).items.push(applicant);
    }
    const result = [...groups.values()];
    for (const group of result) {
      group.items.sort((a, b) => time(b) - time(a) || String(b.id).localeCompare(String(a.id)));
      group.latest = group.items[0];
      group.status = group.latest.status;
      group.count = group.items.length;
    }
    return result.sort((a, b) => time(b.latest) - time(a.latest) || a.key.localeCompare(b.key));
  }

  function loadFlows() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      if (Array.isArray(saved)) return saved;
    } catch (error) { console.warn('Pathway could not read saved drafts.', error); }
    const example = createSampleFlow();
    saveFlows([example]);
    return [example];
  }

  window.PathwayCore = { infoFieldLabel, candidateKey, groupApplicants, STORAGE_KEY, ANSWERS_KEY, REQUIRED_FIELDS, OPTIONAL_FIELDS, FIELD_META, clone, uid, esc, isDigitsOnlyAnswer, createNode, flowIsUsable, createFlow, createSampleFlow, normalizeFlow, nextNode, startAfterInfo, encodeFlow, decodeFlow, saveFlows, loadFlows };
})();
