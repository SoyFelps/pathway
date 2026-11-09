// Deletes the jobs (with their candidates, resumes and AI interviews) and then the companies of a workspace, except the one that stays.
// Used by the scheduled downgrade (billing-reconcile) and by the screen that asks the person to choose a company (billing).
// The same file lives in both functions and must stay identical (a test checks it). It works in batches and stops at the deadline, so a big
// company never exceeds the time of one request: the caller simply calls again until `finished` is true. Safe to repeat.

const RESUME_BUCKET = "applicant-resumes";
const LOGO_BUCKET = "company-logos";
const PAGE = 100;
const FLOW_BATCH = 25;

// deno-lint-ignore no-explicit-any
type Admin = any;

export interface CleanupResult { finished: boolean; jobsDeleted: number; companiesDeleted: number }

async function removeFolder(admin: Admin, bucket: string, folder: string): Promise<void> {
  const paths: string[] = [];
  for (let offset = 0; offset < 10000; offset += PAGE) {
    const { data: files, error } = await admin.storage.from(bucket).list(folder, { limit: PAGE, offset });
    if (error) throw new Error("Files could not be listed for deletion.");
    paths.push(...(files || []).filter((file: { id?: string }) => file.id).map((file: { name: string }) => `${folder}/${file.name}`));
    if (!files || files.length < PAGE) break;
  }
  for (let index = 0; index < paths.length; index += PAGE) {
    const { error } = await admin.storage.from(bucket).remove(paths.slice(index, index + PAGE));
    if (error) throw new Error("Files could not be removed.");
  }
}

export async function deleteCompaniesExcept(admin: Admin, workspaceId: string, keepCompanyId: string, deadline: number): Promise<CleanupResult> {
  const result: CleanupResult = { finished: false, jobsDeleted: 0, companiesDeleted: 0 };
  const { data: keep, error: keepError } = await admin.from("workspace_companies").select("id").eq("id", keepCompanyId).eq("workspace_id", workspaceId).maybeSingle();
  if (keepError) throw keepError;
  if (!keep) throw new Error("The company to keep does not exist.");
  while (Date.now() < deadline) {
    const { data: others, error } = await admin.from("workspace_companies").select("id").eq("workspace_id", workspaceId).neq("id", keepCompanyId).order("created_at").limit(1);
    if (error) throw error;
    if (!others?.length) { result.finished = true; return result; }
    const company = others[0].id as string;
    const { data: flows, error: flowsError } = await admin.from("application_flows").select("id").eq("workspace_id", workspaceId).eq("company_id", company).limit(FLOW_BATCH);
    if (flowsError) throw flowsError;
    for (const flow of flows || []) {
      if (Date.now() >= deadline) return result;
      // New applications stop first, then the resume files, then the records (candidates, history, comments and AI interviews go with the job).
      const { error: pauseError } = await admin.from("application_flows").update({ publication_status: "draft", active_published_flow_id: null }).eq("id", flow.id);
      if (pauseError) throw pauseError;
      await removeFolder(admin, RESUME_BUCKET, `${workspaceId}/${flow.id}`);
      const { error: deleteError } = await admin.from("application_flows").delete().eq("id", flow.id).eq("workspace_id", workspaceId);
      if (deleteError) throw deleteError;
      result.jobsDeleted++;
    }
    if ((flows || []).length === FLOW_BATCH) continue; // maybe more jobs in this company
    await removeFolder(admin, LOGO_BUCKET, `${workspaceId}/${company}`);
    const { error: companyError } = await admin.from("workspace_companies").delete().eq("id", company).eq("workspace_id", workspaceId);
    if (companyError) throw companyError;
    result.companiesDeleted++;
  }
  return result;
}
