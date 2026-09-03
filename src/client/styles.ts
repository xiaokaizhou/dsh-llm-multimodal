/**
 * Card chrome styles. Self-contained CSS injected once at apply() so the
 * settings card looks identical to other plugin cards in the
 * "Settings → 插件" tab.
 *
 * All visual properties use `var(--dsw-alias-*)` design tokens so the card
 * follows the host theme (light/dark) without extra wiring.
 */

const STYLE_ID = 'dsh-llmm-card-styles'

export function ensureStyles(): void {
  if (document.getElementById(STYLE_ID) !== null) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = `
.dsh-llmm-card{list-style:none;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-layer-3);transition:border-color .16s,background .16s;margin-bottom:12px}
.dsh-llmm-card:hover{border-color:var(--dsw-alias-label-dimmed)}
.dsh-llmm-card-open{background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-label-dimmed)}
.dsh-llmm-header{width:100%;appearance:none;border:0;background:none;font:inherit;color:inherit;text-align:left;cursor:pointer;display:flex;align-items:center;gap:12px;padding:14px 16px;border-radius:12px}
.dsh-llmm-header:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.dsh-llmm-head-text{flex:1;min-width:0;display:flex;flex-direction:column;gap:4px}
.dsh-llmm-name{font-size:15px;font-weight:600;line-height:1.4;color:var(--dsw-alias-label-primary)}
.dsh-llmm-description{font-size:13px;line-height:1.5;color:var(--dsw-alias-label-tertiary)}
.dsh-llmm-chevron{flex:none;color:var(--dsw-alias-label-tertiary);transition:transform .16s}
.dsh-llmm-chevron-open{transform:rotate(180deg)}
.dsh-llmm-read-only{margin:0 16px;font-size:12px;line-height:1.5;color:var(--dsw-alias-label-tertiary)}
.dsh-llmm-section-list{list-style:none;padding:0 16px 16px;margin:0;border-top:1px solid var(--dsw-alias-border-l2)}
.dsh-llmm-section{list-style:none;border-top:1px solid var(--dsw-alias-border-l2);padding:10px 0}
.dsh-llmm-section-row{display:flex;align-items:center;gap:10px}
.dsh-llmm-section-label{font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary)}
.dsh-llmm-section-summary{flex:1;min-width:0;font-size:12px;color:var(--dsw-alias-label-tertiary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-llmm-reset-btn{appearance:none;font:inherit;font-size:12px;color:var(--dsw-alias-label-secondary);background:0 0;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;padding:3px 9px;cursor:pointer}
.dsh-llmm-reset-btn:hover:not(:disabled){border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary)}
.dsh-llmm-reset-btn:disabled{opacity:.4;cursor:default}
.dsh-llmm-section-body{display:flex;flex-direction:column;gap:10px;margin-top:8px}
.dsh-llmm-field{display:flex;flex-direction:column;gap:4px;padding:6px 0}
.dsh-llmm-label{font-size:13px;font-weight:500;line-height:1.5;color:var(--dsw-alias-label-primary)}
.dsh-llmm-hint{margin:0;font-size:12px;line-height:1.5;color:var(--dsw-alias-label-tertiary)}
.dsh-llmm-input,.dsh-llmm-select{height:34px;padding:0 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-3);font:inherit;font-size:13px;line-height:1.5;color:var(--dsw-alias-label-primary)}
.dsh-llmm-select{appearance:none;background-image:linear-gradient(45deg,transparent 50%,var(--dsw-alias-label-tertiary) 50%),linear-gradient(135deg,var(--dsw-alias-label-tertiary) 50%,transparent 50%);background-position:calc(100% - 16px) 16px,calc(100% - 11px) 16px;background-size:5px 5px;background-repeat:no-repeat;padding-right:32px}
.dsh-llmm-input:focus-visible,.dsh-llmm-select:focus-visible{outline:none;border-color:var(--dsw-alias-brand-primary)}
.dsh-llmm-input:disabled,.dsh-llmm-select:disabled{color:var(--dsw-alias-label-tertiary);cursor:default}
.dsh-llmm-preset-info{font-size:12px;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-3);border:1px dashed var(--dsw-alias-border-l2);border-radius:6px;padding:6px 10px}
.dsh-llmm-mono{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:11.5px;color:var(--dsw-alias-label-primary)}
`
  document.head.append(style)
}