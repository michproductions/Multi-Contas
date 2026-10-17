import fs from 'node:fs';
import path from 'node:path';

const packageRoot = path.resolve('node_modules/@whiskeysockets/baileys');
if (!fs.existsSync(packageRoot)) {
  console.error('[H2E] Baileys não encontrado em node_modules/@whiskeysockets/baileys.');
  process.exit(1);
}

const textExtensions = new Set(['.js', '.mjs', '.cjs']);
const pending = [packageRoot];
let patchedFiles = 0;
let alreadyPatchedFiles = 0;
let matchedOriginal = 0;
let hasCompanionRefreshHandler = false;
let companionRefreshTraceInstalled = false;

while (pending.length) {
  const current = pending.pop();
  let entries;
  try { entries = fs.readdirSync(current, { withFileTypes: true }); }
  catch { continue; }

  for (const entry of entries) {
    const full = path.join(current, entry.name);
    if (entry.isDirectory()) {
      // Only scan runtime output, avoiding large test/source trees when present.
      if (entry.name !== 'node_modules' && entry.name !== '__tests__' && entry.name !== 'tests') pending.push(full);
      continue;
    }
    if (!entry.isFile() || !textExtensions.has(path.extname(entry.name))) continue;

    let source;
    try { source = fs.readFileSync(full, 'utf8'); } catch { continue; }

    // Instrument the QR-refresh handler so Hostinger logs can confirm whether
    // WhatsApp's companion_reg_refresh notification reaches Baileys.
    if (entry.name === 'companion-reg-client-utils.js') {
      const traceMarker = '[H2E-COMPANION-REFRESH-TRACE]';
      if (source.includes(traceMarker)) {
        companionRefreshTraceInstalled = true;
      } else {
        const handlerPattern = /(export\s+const\s+handleCompanionRegRefresh\s*=\s*\(\s*node\s*,\s*\{\s*creds\s*,\s*emitCredsUpdate\s*,\s*refreshQR\s*,\s*logger\s*\}\s*\)\s*=>\s*\{)/;
        if (handlerPattern.test(source)) {
          source = source.replace(handlerPattern, `$1\n  console.warn('${traceMarker} notification received; creds.me=' + Boolean(creds.me));`);
          fs.writeFileSync(full, source);
          companionRefreshTraceInstalled = true;
          console.log('[H2E] Added diagnostic trace to companion_reg_refresh handler.');
        }
      }
    }

    if (source.includes('companion_reg_refresh')) hasCompanionRefreshHandler = true;
    if (!source.includes('buildAckStanza')) continue;

    const originalPattern = /(buildAckStanza\s*\(\s*node\s*,\s*errorCode\s*,\s*authState\.creds\.me)\.id(\s*\))/g;
    const count = (source.match(originalPattern) || []).length;
    if (count > 0) {
      const output = source.replace(originalPattern, '$1?.id$2');
      fs.writeFileSync(full, output);
      patchedFiles += 1;
      matchedOriginal += count;
      console.log(`[H2E] Corrigido ACK antes do login em ${path.relative(packageRoot, full)} (${count} ocorrência(s)).`);
    } else if (/buildAckStanza\s*\(\s*node\s*,\s*errorCode\s*,\s*authState\.creds\.me\?\.id\s*\)/.test(source)) {
      alreadyPatchedFiles += 1;
    }
  }
}

if (patchedFiles === 0 && alreadyPatchedFiles === 0) {
  console.error('[H2E] Não encontrei a chamada esperada de buildAckStanza em Baileys. A instalação foi interrompida para não publicar sem a correção pré-login. Verifique a versão da dependência.');
  process.exit(1);
}
if (!hasCompanionRefreshHandler) {
  console.error('[H2E] ERRO: a dependência Baileys instalada não contém o handler companion_reg_refresh. Não publique este build: confira o commit 4f263f0 da dependência.');
  process.exit(1);
}
if (!companionRefreshTraceInstalled) {
  console.error('[H2E] Não foi possível instrumentar o handler companion_reg_refresh em lib/Utils/companion-reg-client-utils.js. Confira a estrutura da dependência antes de publicar.');
  process.exit(1);
}
console.log('[H2E] Handler companion_reg_refresh encontrado e instrumentado na Baileys instalada.');
console.log(`[H2E] Patch de pareamento pré-login concluído. Arquivos alterados: ${patchedFiles}; já corrigidos: ${alreadyPatchedFiles}; ocorrências alteradas: ${matchedOriginal}.`);
