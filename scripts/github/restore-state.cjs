// Called by actions/github-script in both workflows. Only artifacts of the trusted
// default-branch update workflow are eligible; price/hash checks happen in TypeScript.
module.exports = async ({ github, context }) => {
  const fs = require('node:fs');
  fs.mkdirSync('reports', { recursive: true });
  const { data } = await github.rest.actions.listWorkflowRuns({
    ...context.repo, workflow_id: 'update-prices.yml',
    branch: context.payload.repository.default_branch, status: 'completed', per_page: 10,
  });
  for (const run of data.workflow_runs) {
    const artifacts = await github.rest.actions.listWorkflowRunArtifacts({ ...context.repo, run_id: run.id });
    const artifact = artifacts.data.artifacts.find(a => a.name === 'pricing-run-state' && !a.expired);
    if (!artifact) continue;
    const archive = await github.rest.actions.downloadArtifact({ ...context.repo, artifact_id: artifact.id, archive_format: 'zip' });
    fs.writeFileSync('reports/prior-state.zip', Buffer.from(archive.data));
    return;
  }
};
