import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface ExportedSlashOption {
  name: string;
  description: string;
  type: string;
  required: boolean;
}

export interface ExportedCommand {
  name: string;
  description: string;
  module: string;
  aliases: string[];
  adminOnly: boolean;
  supportsSlash: boolean;
  supportsPrefix: boolean;
  prefixUsage: string;
  slashOptions: ExportedSlashOption[];
  requiredClientPermissions: string[];
  file: string;
}

export interface ExportedCommandData {
  generatedAt: string;
  source: string;
  count: number;
  defaultPrefix: string;
  commands: ExportedCommand[];
}

const COMMANDS_DIR = 'src/commands';
const ENV_FILE = 'src/config/env.ts';
const FALLBACK_PREFIX = '!';
const DEFAULT_OUT = 'site/src/data/commands.json';

const QUOTED_STRING_PATTERN = /['"]([^'"]+)['"]/g;
const NAME_PATTERN = /name:\s*['"]([^'"]+)['"]/;
const DESCRIPTION_PATTERN = /description:\s*['"]([^'"]+)['"]/;
const ALIASES_PATTERN = /aliases:\s*\[([^\]]*)\]/;
const PERMISSIONS_PATTERN = /requiredClientPermissions:\s*\[([^\]]*)\]/;
const SLASH_OPTION_PATTERN =
  /\.add(\w+)Option\(\s*\(option\)\s*=>\s*option\s*\.setName\(\s*['"]([^'"]+)['"]\s*\)\s*\.setDescription\(\s*['"]([^'"]+)['"]\s*\)([^)]*?)\)/g;

const extractQuotedList = (raw: string): string[] => {
  const values: string[] = [];
  const matcher = new RegExp(QUOTED_STRING_PATTERN);
  let match: RegExpExecArray | null = matcher.exec(raw);
  while (match !== null) {
    const value = match[1];
    if (value !== undefined && value.length > 0) values.push(value);
    match = matcher.exec(raw);
  }
  return values;
};

const extractFirst = (content: string, pattern: RegExp): string | null => {
  const match = pattern.exec(content);
  const value = match?.[1];
  return value === undefined || value.length === 0 ? null : value;
};

const extractSlashOptions = (content: string): ExportedSlashOption[] => {
  const options: ExportedSlashOption[] = [];
  const matcher = new RegExp(SLASH_OPTION_PATTERN);
  let match: RegExpExecArray | null = matcher.exec(content);
  while (match !== null) {
    const type = match[1] ?? 'String';
    const name = match[2] ?? '';
    const description = match[3] ?? '';
    const tail = match[4] ?? '';
    if (name.length > 0) {
      options.push({ name, description, type, required: tail.includes('.setRequired(true') });
    }
    match = matcher.exec(content);
  }
  return options;
};

const DEFAULT_PREFIX_PATTERN = /DEFAULT_PREFIX:[^;]*?\.default\(\s*['"]([^'"]+)['"]\s*\)/;

/** Reads the bot's default prefix from src/config/env.ts so docs never hardcode it. */
export const readDefaultPrefix = (envSource: string): string => {
  const match = DEFAULT_PREFIX_PATTERN.exec(envSource);
  const value = match?.[1];
  return value !== undefined && value.length > 0 ? value : FALLBACK_PREFIX;
};

/** Parses one command source file without importing Discord runtime. */
export const parseCommandFile = (
  content: string,
  filePath: string,
  defaultPrefix: string = FALLBACK_PREFIX
): ExportedCommand | null => {
  const name = extractFirst(content, NAME_PATTERN);
  const description = extractFirst(content, DESCRIPTION_PATTERN);
  if (name === null || description === null) return null;

  const segments = filePath.split(/[/\\]/);
  const module = segments.length >= 2 ? (segments[segments.length - 2] ?? 'other') : 'other';
  const aliasesRaw = extractFirst(content, ALIASES_PATTERN) ?? '';
  const permissionsRaw = extractFirst(content, PERMISSIONS_PATTERN) ?? '';
  const slashOptions = extractSlashOptions(content);
  const supportsSlash = content.includes('chatInputRun');
  const supportsPrefix = content.includes('messageRun');
  const adminOnly = content.includes('AdminCommand') || module === 'admin';

  // Deduplicate slash options by name for clean display (subcommands reuse same names) — keep longest description
  const dedupedMap = new Map<string, ExportedSlashOption>();
  for (const option of slashOptions) {
    const existing = dedupedMap.get(option.name);
    if (!existing || option.description.length > existing.description.length) {
      dedupedMap.set(option.name, option);
    }
    // Prefer required=true if any variant requires it
    if (existing && option.required && !existing.required) {
      dedupedMap.set(option.name, {
        ...existing,
        required: true,
        description: existing.description.length > option.description.length ? existing.description : option.description
      });
    }
  }
  const dedupedSlashOptions = [...dedupedMap.values()];
  // Detect subcommands for better prefix usage — handles multiline chains like `sub\n  .setName`
  const subNames = [
    ...content.matchAll(/\.addSubcommand\(\s*\(\s*\w+\s*\)\s*=>\s*\w+\s*\.setName\(\s*['"]([^'"]+)['"]\s*\)/g)
  ]
    .map((m) => m[1] ?? '')
    .filter((name) => name.length > 0);

  let prefixUsage: string;
  let finalSlashOptions = dedupedSlashOptions.length > 0 ? dedupedSlashOptions : slashOptions;
  // Polish givepermission docs: clean role description and ensure long permissions list
  if (name === 'givepermission' && finalSlashOptions.length > 0) {
    finalSlashOptions = finalSlashOptions.map((option) => {
      if (option.name === 'role') {
        return { ...option, description: 'Role to manage (grant/remove/list/clear)', required: true };
      }
      if (option.name === 'permissions') {
        return {
          ...option,
          description:
            'Permissions: admin, ban, unban, softban, kick, timeout, untimeout, warn, mute, unmute, jail, unjail, purge, slowmode, nick, role, voice, hide, unhide, cases — presets: chatmod, mod, seniormod, full, all (admin owner only)',
          required: true
        };
      }
      return option;
    });
  }
  if (subNames.length > 0) {
    const optionArgs = finalSlashOptions
      .map((option) => (option.required ? `<${option.name}>` : `[${option.name}]`))
      .join(' ');
    if (name === 'givepermission') {
      // Human-friendly for the fake-permission command — covers presets too
      prefixUsage = `${defaultPrefix}givepermission add <role> <permissions> | ${defaultPrefix}gp @Role <permissions> | ${defaultPrefix}givepermission guide`;
    } else if (name === 'warn' || name === 'cases' || name === 'voice' || name === 'autoresponder') {
      // Keep existing behavior but with deduplicated options and explicit subcommand placeholder
      prefixUsage = `${defaultPrefix}${name} <${subNames.join('|')}> ${optionArgs}`.trim();
    } else {
      prefixUsage = `${defaultPrefix}${name} <${subNames.join('|')}> ${optionArgs}`.trim();
    }
  } else {
    const usageArgs = finalSlashOptions.map((option) => (option.required ? `<${option.name}>` : `[${option.name}]`));
    prefixUsage = [`${defaultPrefix}${name}`, ...usageArgs].join(' ').trim();
  }

  return {
    name,
    description,
    module: module.toLowerCase(),
    aliases: extractQuotedList(aliasesRaw),
    adminOnly,
    supportsSlash,
    supportsPrefix,
    prefixUsage,
    slashOptions: finalSlashOptions,
    requiredClientPermissions: extractQuotedList(permissionsRaw),
    file: filePath.replace(/\\/g, '/')
  };
};

const collectCommandFiles = async (dir: string): Promise<string[]> => {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectCommandFiles(full)));
    } else if (entry.isFile() && entry.name.endsWith('.ts')) {
      files.push(full);
    }
  }
  return files.sort();
};

/** Scans src/commands and returns sorted command metadata. */
export const collectCommands = async (
  repoRoot: string
): Promise<{ commands: ExportedCommand[]; defaultPrefix: string }> => {
  const commandsDir = path.join(repoRoot, COMMANDS_DIR);
  const envSource = await readFile(path.join(repoRoot, ENV_FILE), 'utf8').catch(() => '');
  const defaultPrefix = readDefaultPrefix(envSource);
  const files = await collectCommandFiles(commandsDir);
  const commands: ExportedCommand[] = [];
  for (const file of files) {
    const content = await readFile(file, 'utf8');
    const relative = path.relative(repoRoot, file);
    const parsed = parseCommandFile(content, relative, defaultPrefix);
    if (parsed !== null) commands.push(parsed);
  }
  const sorted = commands.sort((a, b) => a.module.localeCompare(b.module) || a.name.localeCompare(b.name));
  return { commands: sorted, defaultPrefix };
};

export const buildExportPayload = (
  commands: ExportedCommand[],
  defaultPrefix: string = FALLBACK_PREFIX
): ExportedCommandData => ({
  generatedAt: new Date().toISOString(),
  source: COMMANDS_DIR,
  count: commands.length,
  defaultPrefix,
  commands
});

const resolveRepoRoot = (): string => path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const parseArgs = (argv: string[]): { check: boolean; out: string } => {
  let check = false;
  let out = DEFAULT_OUT;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--check') check = true;
    if (arg === '--out') {
      const next = argv[index + 1];
      if (next !== undefined && next.length > 0) {
        out = next;
        index += 1;
      }
    }
  }
  return { check, out };
};

const run = async (argv: string[]): Promise<void> => {
  const repoRoot = resolveRepoRoot();
  const { check, out } = parseArgs(argv);
  const { commands, defaultPrefix } = await collectCommands(repoRoot);
  const payload = buildExportPayload(commands, defaultPrefix);
  const outPath = path.resolve(repoRoot, out);

  if (check) {
    const current = await readFile(outPath, 'utf8').catch(() => null);
    if (current === null) {
      console.error(`Missing ${out}. Run npm run docs:export first.`);
      process.exitCode = 1;
      return;
    }
    const parsed = JSON.parse(current) as ExportedCommandData;
    const normalize = (data: ExportedCommandData): string =>
      JSON.stringify({ commands: data.commands, defaultPrefix: data.defaultPrefix });
    if (normalize(parsed) !== normalize(payload)) {
      console.error(`Stale ${out}. Run npm run docs:export and commit the result.`);
      process.exitCode = 1;
      return;
    }
    console.log(`commands.json is current (${payload.count} commands).`);
    return;
  }

  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  console.log(`Exported ${payload.count} commands to ${path.relative(repoRoot, outPath)}`);
};

void run(process.argv.slice(2)).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
