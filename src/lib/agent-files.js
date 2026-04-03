import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';

const AGENT_DIR = join(process.cwd(), 'local-agent');

export function agentFilePath(agentId) {
  return join(AGENT_DIR, `${agentId}.json`);
}

function resolveAgentPath(input) {
  if (!input) {
    throw new Error('Agent file or agent id is required.');
  }

  if (isAbsolute(input) || input.endsWith('.json') || input.includes('/')) {
    return input;
  }

  return agentFilePath(input);
}

export async function saveAgentInstallation(installation) {
  await mkdir(AGENT_DIR, { recursive: true });
  const filePath = agentFilePath(installation.agentId);
  await writeFile(filePath, JSON.stringify(installation, null, 2), 'utf8');
  return filePath;
}

export async function loadAgentInstallation(input) {
  const filePath = resolveAgentPath(input);
  const raw = await readFile(filePath, 'utf8');
  return { filePath, installation: JSON.parse(raw) };
}
