/** Design system, layout and component styles for the Subagent Director
 * client surfaces. One additive stylesheet keyed by `data-plugin-css`; every
 * neutral surface and text colour comes from the official DSH theme tokens so
 * light and dark themes stay correct. Card accents are the only intentional
 * identity colours. */

/** Plugin-owned style tag id; the DSH client loader removes tags by data-plugin. */
const STYLE_TAG_ID = 'dsh-plugin-subagent-director/ui.css';

/** The additive design-system stylesheet for this plugin. */
export const uiCss = `
.sd-page{box-sizing:border-box;width:100%;max-width:1100px;display:flex;flex-direction:column;gap:18px;color:var(--dsw-alias-label-primary);font-family:var(--dsw-font-family);}
.sd-page-head{display:flex;align-items:flex-end;justify-content:space-between;gap:18px;flex-wrap:wrap;}
.sd-page-head-main{display:flex;flex-direction:column;gap:4px;min-width:0;}
.sd-eyebrow{font:var(--dsw-font-xxxs-strong-11);letter-spacing:.04em;color:var(--dsw-alias-label-tertiary);text-transform:uppercase;}
.sd-page-title{margin:0;font:var(--dsw-font-l-20);font-weight:650;line-height:28px;letter-spacing:-.01em;}
.sd-page-title-row{display:flex;align-items:center;gap:8px;min-width:0;}
.sd-page-title-icon{flex:none;color:var(--dsw-alias-state-business-primary);}
.sd-page-intro{margin:0;max-width:720px;color:var(--dsw-alias-label-secondary);font:var(--dsw-font-xs-13);line-height:20px;}
.sd-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap;}
.sd-actions-end{justify-content:flex-end;}
.sd-banner{box-sizing:border-box;display:flex;align-items:flex-start;gap:10px;padding:12px 14px;border:1px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-md,8px);background:var(--dsw-alias-bg-layer-1);}
.sd-banner>div{flex:1;min-width:0;}
.sd-banner strong{display:block;font:var(--dsw-font-s-14);font-weight:600;line-height:20px;}
.sd-banner p{margin:2px 0 0;color:var(--dsw-alias-label-secondary);font:var(--dsw-font-xxs-12);line-height:18px;overflow-wrap:anywhere;}
.sd-banner-warn{border-color:color-mix(in srgb,var(--dsw-alias-state-warn-label) 30%,transparent);background:color-mix(in srgb,var(--dsw-alias-state-warn-label) 6%,var(--dsw-alias-bg-layer-1));}
.sd-banner-error{border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary) 35%,transparent);background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 6%,var(--dsw-alias-bg-layer-1));}
.sd-banner-info{border-color:color-mix(in srgb,var(--dsw-alias-state-business-primary) 28%,transparent);background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 5%,var(--dsw-alias-bg-layer-1));}
.sd-toast{box-sizing:border-box;display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 12px;border:1px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-md,8px);font:var(--dsw-font-xxs-12);line-height:18px;background:var(--dsw-alias-bg-layer-1);}
.sd-toast.is-success{border-color:color-mix(in srgb,var(--dsw-alias-state-success-primary) 32%,transparent);background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 7%,var(--dsw-alias-bg-layer-1));}
.sd-toast.is-error{border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary) 35%,transparent);background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 7%,var(--dsw-alias-bg-layer-1));}
.sd-toast.is-info{border-color:color-mix(in srgb,var(--dsw-alias-state-business-primary) 28%,transparent);background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 5%,var(--dsw-alias-bg-layer-1));}
.sd-stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;}
.sd-stat{box-sizing:border-box;display:flex;flex-direction:column;gap:2px;min-width:0;padding:12px 14px;border:1px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-md,8px);background:var(--dsw-alias-bg-layer-1);}
.sd-stat-label{font:var(--dsw-font-xxxs-strong-11);letter-spacing:.02em;color:var(--dsw-alias-label-tertiary);text-transform:uppercase;}
.sd-stat-value{font:var(--dsw-font-s-14);font-weight:650;line-height:20px;white-space:normal;overflow-wrap:anywhere;}
.sd-stat-hint{font:var(--dsw-font-xxxs-11);line-height:15px;color:var(--dsw-alias-label-tertiary);}
.sd-group{display:flex;flex-direction:column;gap:12px;min-width:0;}
.sd-group-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap;}
.sd-group-head h2{margin:0;font:var(--dsw-font-m-16);font-weight:650;line-height:24px;}
.sd-toolbar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;}
.sd-search-wrap{position:relative;display:flex;align-items:center;flex:1;min-width:220px;max-width:360px;}
.sd-search-wrap>svg{position:absolute;left:10px;color:var(--dsw-alias-label-tertiary);pointer-events:none;}
.sd-search{box-sizing:border-box;width:100%;height:32px;padding:0 28px 0 32px;border:1px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-sm,6px);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:var(--dsw-font-xs-13);outline:none;transition:border-color .15s ease,box-shadow .15s ease;}
.sd-search::placeholder{color:var(--dsw-alias-label-tertiary);}
.sd-search:focus{border-color:var(--dsw-alias-brand-primary,var(--dsw-alias-state-business-primary));box-shadow:0 0 0 2px color-mix(in srgb,var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary)) 14%,transparent);}
.sd-search-clear{position:absolute;right:4px;width:24px;height:24px;}
.sd-segmented{display:inline-flex;align-items:center;gap:2px;padding:2px;border:1px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-md,8px);background:var(--dsw-alias-bg-layer-3);}
.sd-segmented button{height:26px;padding:0 10px;border:none;border-radius:var(--dsw-radius-sm,6px);background:transparent;color:var(--dsw-alias-label-secondary);font:var(--dsw-font-xxs-12);cursor:pointer;transition:background-color .15s ease,color .15s ease,box-shadow .15s ease;}
.sd-segmented button:hover{color:var(--dsw-alias-label-primary);}
.sd-segmented button.is-active{background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);box-shadow:0 1px 2px color-mix(in srgb,#000 10%,transparent);}
.sd-toolbar .sd-sort{width:auto;min-width:150px;flex:none;}
.sd-batchbar{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;padding:8px 10px;border:1px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-md,8px);background:var(--dsw-alias-bg-layer-3);}
.sd-batchbar-main{display:flex;align-items:center;gap:8px;flex-wrap:wrap;}
.sd-batchbar-main strong{font:var(--dsw-font-xxs-strong-12);}
.sd-card-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:12px;min-width:0;}
.sd-card-tile{box-sizing:border-box;position:relative;display:flex;flex-direction:column;gap:10px;min-width:0;padding:14px;border:1px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-lg,12px);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);transition:border-color .15s ease,box-shadow .15s ease,background-color .15s ease,transform .15s ease;}
.sd-card-tile:hover{border-color:var(--dsw-alias-border-l3);box-shadow:var(--dsw-shadow-lv1);}
.sd-card-tile.is-selectable{cursor:pointer;}
.sd-card-tile.is-selectable:hover{transform:translateY(-1px);}
.sd-card-tile.is-selected{border-color:var(--sd-accent);background:color-mix(in srgb,var(--sd-accent) 5%,var(--dsw-alias-bg-layer-1));}
.sd-card-tile.is-disabled{opacity:.62;}
.sd-card-tile.is-disabled:hover{opacity:.85;}
.sd-card-select{position:absolute;top:10px;left:10px;z-index:1;display:flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:6px;background:var(--dsw-alias-bg-layer-1);box-shadow:0 0 0 1px var(--dsw-alias-border-l1);}
.sd-card-select input{accent-color:var(--sd-accent);margin:0;cursor:pointer;}
.sd-card-tile-head{display:flex;align-items:flex-start;gap:10px;min-width:0;}
.sd-card-avatar{display:flex;align-items:center;justify-content:center;flex:none;width:40px;height:40px;border-radius:10px;background:color-mix(in srgb,var(--sd-accent) 16%,var(--dsw-alias-bg-layer-1));color:color-mix(in srgb,var(--sd-accent) 78%,var(--dsw-alias-label-primary));font-size:20px;line-height:1;font-weight:600;}
.sd-card-avatar.is-lg{width:48px;height:48px;border-radius:12px;font-size:24px;}
.sd-avatar-picker{display:flex;align-items:center;gap:12px;flex-wrap:wrap;}
.sd-avatar-options{display:flex;align-items:center;gap:6px;flex-wrap:wrap;min-width:0;}
.sd-avatar-option{display:inline-flex;align-items:center;justify-content:center;flex:none;width:32px;height:32px;padding:0;border:1px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-sm,6px);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-size:16px;line-height:1;cursor:pointer;transition:border-color .15s ease,background-color .15s ease,color .15s ease;}
.sd-avatar-option.is-initial{width:auto;padding:0 8px;font:var(--dsw-font-xxxs-strong-11);color:var(--dsw-alias-label-secondary);}
.sd-avatar-option:hover{border-color:var(--dsw-alias-border-l3);background:var(--dsw-alias-interactive-bg-hover);}
.sd-avatar-option.is-active{border-color:var(--dsw-alias-state-business-primary);background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 10%,var(--dsw-alias-bg-layer-1));color:var(--dsw-alias-state-business-primary);}
.sd-avatar-option.is-initial.is-active{color:var(--dsw-alias-state-business-primary);}
.sd-avatar-custom{display:inline-flex;align-items:center;gap:5px;height:32px;padding:0 8px;border:1px dashed var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-sm,6px);color:var(--dsw-alias-label-secondary);font:var(--dsw-font-xxxs-strong-11);}
.sd-avatar-custom-glyph{font-size:16px;line-height:1;}
.sd-card-tile-title{display:flex;flex-direction:column;gap:2px;min-width:0;flex:1;}
.sd-card-tile-title h3{margin:0;font:var(--dsw-font-s-14);font-weight:650;line-height:20px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.sd-card-tile-sub{display:flex;align-items:center;gap:6px;min-width:0;flex-wrap:wrap;}
.sd-badge{display:inline-flex;align-items:center;gap:3px;height:18px;padding:0 6px;border-radius:999px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-secondary);font:var(--dsw-font-xxxs-strong-11);line-height:1;white-space:nowrap;}
.sd-badge-accent{border-color:color-mix(in srgb,var(--dsw-alias-state-business-primary) 30%,transparent);background:var(--dsw-alias-state-business-tertiary);color:var(--dsw-alias-state-business-primary);}
.sd-star-btn.is-on{color:var(--dsw-alias-state-business-primary);}
.sd-card-tile-avoid{margin:0;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;color:var(--dsw-alias-label-tertiary);font:var(--dsw-font-xs-13);line-height:19px;white-space:pre-wrap;overflow-wrap:anywhere;}
.sd-card-tile-guidance{margin:0;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;color:var(--dsw-alias-label-secondary);font:var(--dsw-font-xs-13);line-height:19px;white-space:pre-wrap;overflow-wrap:anywhere;}
.sd-card-tile-tags{display:flex;align-items:center;gap:5px;flex-wrap:wrap;min-height:18px;}
.sd-card-tile-meta{display:flex;align-items:center;gap:5px;flex-wrap:wrap;}
.sd-card-tile-status{display:flex;align-items:center;gap:6px;flex-wrap:wrap;}
.sd-status-stat{font:var(--dsw-font-xxxs-11);line-height:16px;color:var(--dsw-alias-label-tertiary);white-space:nowrap;font-variant-numeric:tabular-nums;}
.sd-pin{display:inline-flex;align-items:center;gap:4px;margin-left:auto;font:var(--dsw-font-xxxs-11);line-height:16px;color:var(--dsw-alias-label-secondary);cursor:pointer;white-space:nowrap;}
.sd-pin input{margin:0;accent-color:var(--dsw-alias-state-business-primary);cursor:pointer;}
.sd-chip{display:inline-flex;align-items:center;gap:3px;height:20px;padding:0 7px;border-radius:999px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-secondary);font:var(--dsw-font-xxxs-strong-11);line-height:1;white-space:nowrap;max-width:100%;overflow:hidden;text-overflow:ellipsis;}
.sd-chip-accent{border-color:color-mix(in srgb,var(--dsw-alias-state-business-primary) 28%,transparent);background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 8%,var(--dsw-alias-bg-layer-1));color:var(--dsw-alias-state-business-primary);}
.sd-chip-model{font-family:var(--ds-font-family-code,monospace);font-size:10px;}
.sd-chip-muted{opacity:.75;}
.sd-chip-warn{border-color:color-mix(in srgb,var(--dsw-alias-state-warn-label) 34%,transparent);background:color-mix(in srgb,var(--dsw-alias-state-warn-label) 8%,var(--dsw-alias-bg-layer-1));color:var(--dsw-alias-state-warn-label);}
.sd-card-tile-foot{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:auto;padding-top:8px;border-top:1px solid var(--dsw-alias-border-l1);}
.sd-menu-wrap{position:relative;display:inline-flex;}
.sd-menu{position:absolute;right:0;bottom:32px;z-index:20;display:flex;flex-direction:column;gap:1px;min-width:160px;padding:4px;border:1px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-md,8px);background:var(--dsw-alias-bg-layer-1);box-shadow:var(--dsw-shadow-lv2,0 8px 24px color-mix(in srgb,#000 18%,transparent));}
.sd-menu button{display:flex;align-items:center;gap:8px;width:100%;padding:7px 8px;border:none;border-radius:var(--dsw-radius-sm,6px);background:transparent;color:var(--dsw-alias-label-primary);font:var(--dsw-font-xxs-12);text-align:left;cursor:pointer;}
.sd-menu button:hover{background:var(--dsw-alias-interactive-bg-hover);}
.sd-menu button.is-danger{color:var(--dsw-alias-state-error-primary);}
.sd-empty-state{display:flex;flex-direction:column;align-items:center;gap:8px;padding:42px 20px;border:1px dashed var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-lg,12px);background:var(--dsw-alias-bg-layer-1);text-align:center;}
.sd-empty-icon{display:flex;align-items:center;justify-content:center;width:42px;height:42px;border-radius:12px;background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-secondary);}
.sd-empty-state h3{margin:2px 0 0;font:var(--dsw-font-m-16);font-weight:600;line-height:24px;}
.sd-empty-state p{margin:0;max-width:460px;}
.sd-panel{border:1px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-lg,12px);background:var(--dsw-alias-bg-layer-1);}
.sd-panel summary{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px;cursor:pointer;list-style:none;}
.sd-panel summary::-webkit-details-marker{display:none;}
.sd-panel-title{display:flex;flex-direction:column;gap:2px;min-width:0;}
.sd-panel-title strong{font:var(--dsw-font-s-14);font-weight:650;line-height:20px;}
.sd-panel-chevron{flex:none;color:var(--dsw-alias-label-tertiary);transition:transform .15s ease;}
.sd-panel[open] .sd-panel-chevron{transform:rotate(90deg);}
.sd-default{display:flex;flex-direction:column;gap:12px;padding:0 14px 14px;}
.sd-footnote{margin:0;color:var(--dsw-alias-label-tertiary);font:var(--dsw-font-xxxs-11);line-height:16px;}
.sd-grid{display:grid;gap:12px;min-width:0;}
.sd-grid-2{grid-template-columns:repeat(2,minmax(0,1fr));}
.sd-grid-3{grid-template-columns:repeat(3,minmax(0,1fr));}
.sd-field{display:flex;flex-direction:column;gap:6px;min-width:0;}
.sd-label{font:var(--dsw-font-xxs-strong-12);line-height:18px;color:var(--dsw-alias-label-primary);}
.sd-input,.sd-select,.sd-textarea{box-sizing:border-box;width:100%;border:1px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-sm,6px);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:var(--dsw-font-xs-13);outline:none;transition:border-color .15s ease,box-shadow .15s ease;}
.sd-input,.sd-select{height:32px;padding:0 10px;}
.sd-input::placeholder,.sd-textarea::placeholder{color:var(--dsw-alias-label-tertiary);}
.sd-input:hover:not(:disabled),.sd-select:hover:not(:disabled),.sd-textarea:hover:not(:disabled),.sd-search:hover:not(:disabled){border-color:var(--dsw-alias-border-l3);}
.sd-input:focus,.sd-select:focus,.sd-textarea:focus{border-color:var(--dsw-alias-brand-primary,var(--dsw-alias-state-business-primary));box-shadow:0 0 0 2px color-mix(in srgb,var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary)) 14%,transparent);}
.sd-input:disabled,.sd-select:disabled,.sd-textarea:disabled{opacity:.55;cursor:not-allowed;}
.sd-textarea{min-height:92px;padding:7px 10px;line-height:20px;resize:vertical;}
.sd-textarea-code{font-family:var(--ds-font-family-code,monospace);font-size:12px;}
.sd-mono-input{font-family:var(--ds-font-family-code,monospace);font-size:12px;}
.sd-counter{align-self:flex-end;color:var(--dsw-alias-label-tertiary);font:var(--dsw-font-xxxs-11);line-height:15px;font-variant-numeric:tabular-nums;}
.sd-toggle{display:flex;align-items:flex-start;gap:10px;cursor:pointer;font:var(--dsw-font-xs-13);line-height:20px;}
.sd-toggle>input{margin-top:3px;accent-color:var(--dsw-alias-state-business-primary);flex:none;}
.sd-toggle>span{display:flex;flex-direction:column;gap:2px;min-width:0;}
.sd-fieldset{display:flex;flex-direction:column;gap:8px;margin:0;padding:0;border:none;min-width:0;}
.sd-radio{display:flex;align-items:flex-start;gap:8px;cursor:pointer;font:var(--dsw-font-xs-13);line-height:20px;}
.sd-radio>input{margin-top:3px;accent-color:var(--dsw-alias-state-business-primary);flex:none;}
.sd-radio>span{display:flex;flex-direction:column;gap:2px;min-width:0;}
.sd-hint{margin:0;color:var(--dsw-alias-label-secondary);font:var(--dsw-font-xxs-12);line-height:18px;}
.sd-note{margin:0;color:var(--dsw-alias-label-tertiary);font:var(--dsw-font-xxxs-11);line-height:16px;overflow-wrap:anywhere;}
.sd-mono{font-family:var(--ds-font-family-code,monospace);font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums;word-break:break-all;}
.sd-error-text{margin:0;color:var(--dsw-alias-state-error-primary);font:var(--dsw-font-xxs-12);line-height:18px;}
.sd-warn-text{margin:0;color:var(--dsw-alias-state-warn-label);font:var(--dsw-font-xxs-12);line-height:18px;}
.sd-success-text{margin:0;color:var(--dsw-alias-state-success-primary);font:var(--dsw-font-xxs-12);line-height:18px;}
.sd-btn{box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;gap:5px;height:32px;padding:0 12px;border:1px solid transparent;border-radius:var(--dsw-radius-sm,6px);font:var(--dsw-font-xs-13);font-weight:500;line-height:1;cursor:pointer;white-space:nowrap;transition:background-color .15s ease,border-color .15s ease,color .15s ease,opacity .15s ease;}
.sd-btn:focus-visible,.sd-icon-btn:focus-visible,.sd-segmented button:focus-visible,.sd-menu button:focus-visible,.sd-search:focus-visible,.sd-avatar-option:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:2px;}
.sd-btn:disabled{opacity:.5;cursor:not-allowed;}
.sd-btn-sm{height:28px;padding:0 10px;font:var(--dsw-font-xxs-strong-12);}
.sd-btn-primary{background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-foreground);}
.sd-btn-primary:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover,var(--dsw-alias-button-primary-fill));}
.sd-btn-ghost{background:transparent;border-color:var(--dsw-alias-border-l2);color:var(--dsw-alias-label-primary);}
.sd-btn-ghost:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);border-color:var(--dsw-alias-border-l3);}
.sd-btn-danger{background:transparent;border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary) 45%,transparent);color:var(--dsw-alias-state-error-primary);}
.sd-btn-danger:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover-danger,color-mix(in srgb,var(--dsw-alias-state-error-primary) 8%,transparent));}
.sd-icon-btn{display:inline-flex;align-items:center;justify-content:center;flex:none;width:28px;height:28px;padding:0;border:1px solid transparent;border-radius:var(--dsw-radius-sm,6px);background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;transition:background-color .15s ease,color .15s ease;}
.sd-icon-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary);}
.sd-icon-btn:disabled{opacity:.45;cursor:not-allowed;}
.sd-overlay{position:fixed;inset:0;z-index:1000;display:flex;align-items:center;justify-content:center;padding:24px;background:color-mix(in srgb,#000 38%,transparent);backdrop-filter:blur(2px);overflow:auto;}
.sd-dialog{box-sizing:border-box;display:flex;flex-direction:column;width:min(760px,100%);max-height:88vh;border:1px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-xl,16px);background:var(--dsw-alias-bg-layer-1);box-shadow:var(--dsw-shadow-lv3,0 24px 64px color-mix(in srgb,#000 28%,transparent));overflow:hidden;}
.sd-dialog-head{display:flex;align-items:flex-start;justify-content:space-between;gap:14px;padding:16px 18px;border-bottom:1px solid var(--dsw-alias-border-l1);}
.sd-dialog-head h2{margin:0;font-size:18px;font-weight:650;line-height:26px;}
.sd-dialog-head p{margin:4px 0 0;}
.sd-dialog-body{display:flex;flex-direction:column;gap:16px;padding:18px;overflow-y:auto;min-height:0;}
.sd-dialog-foot{display:flex;align-items:center;justify-content:flex-end;gap:8px;padding:12px 18px;border-top:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);}
.sd-form-section{display:flex;flex-direction:column;gap:10px;padding-top:14px;border-top:1px solid var(--dsw-alias-border-l1);}
.sd-form-section:first-child{padding-top:0;border-top:none;}
.sd-form-section h3{margin:0;font:var(--dsw-font-xs-strong-13);font-weight:650;line-height:20px;}
.sd-confirm{width:min(460px,100%);}
.sd-import{width:min(640px,100%);}
.sd-confirm-title{display:flex;align-items:center;gap:10px;min-width:0;}
.sd-confirm-icon{display:flex;align-items:center;justify-content:center;flex:none;width:32px;height:32px;border-radius:10px;background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 10%,var(--dsw-alias-bg-layer-1));color:var(--dsw-alias-state-error-primary);}
.sd-confirm-body{margin:0;color:var(--dsw-alias-label-secondary);font:var(--dsw-font-xs-13);line-height:20px;overflow-wrap:anywhere;}
.sd-migrate{display:flex;flex-direction:column;gap:10px;padding:10px 12px;border:1px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-md,8px);background:var(--dsw-alias-bg-layer-3);}
.sd-dropzone{box-sizing:border-box;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;width:100%;padding:26px 16px;border:1px dashed var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-lg,12px);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);font:var(--dsw-font-xs-13);text-align:center;cursor:pointer;transition:border-color .15s ease,background-color .15s ease;}
.sd-dropzone:hover,.sd-dropzone.is-dragging{border-color:var(--dsw-alias-state-business-primary);background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 5%,var(--dsw-alias-bg-layer-1));}
.sd-dropzone strong{font:var(--dsw-font-s-14);font-weight:600;color:var(--dsw-alias-label-primary);}
.sd-import-result{display:flex;flex-direction:column;gap:6px;padding:12px;border:1px solid color-mix(in srgb,var(--dsw-alias-state-success-primary) 30%,transparent);border-radius:var(--dsw-radius-md,8px);background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 6%,var(--dsw-alias-bg-layer-1));}
.sd-import-result-head{display:flex;align-items:center;gap:6px;color:var(--dsw-alias-state-success-primary);font:var(--dsw-font-xxs-strong-12);}
.sd-import-issues{display:flex;flex-direction:column;gap:4px;padding-top:6px;border-top:1px solid var(--dsw-alias-border-l1);}
.sd-import-issues-head{display:flex;align-items:center;gap:4px;color:var(--dsw-alias-state-warn-label);font:var(--dsw-font-xxxs-strong-11);}
.sd-import-issues ul{margin:0;padding-left:16px;color:var(--dsw-alias-label-secondary);font:var(--dsw-font-xxs-12);line-height:18px;overflow-wrap:anywhere;}
.sd-skeleton{display:flex;flex-direction:column;gap:10px;}
.sd-skeleton>div{height:52px;border-radius:var(--dsw-radius-md,8px);background:linear-gradient(90deg,var(--dsw-alias-bg-layer-1) 0%,var(--dsw-alias-bg-layer-3) 50%,var(--dsw-alias-bg-layer-1) 100%);background-size:200% 100%;animation:sd-shimmer 1.4s ease-in-out infinite;}
@keyframes sd-shimmer{0%{background-position:200% 0;}100%{background-position:-200% 0;}}
.sd-accent-blue{--sd-accent:#4f7cff;}
.sd-accent-violet{--sd-accent:#8b5cf6;}
.sd-accent-green{--sd-accent:#16a34a;}
.sd-accent-amber{--sd-accent:#d97706;}
.sd-accent-rose{--sd-accent:#e11d66;}
.sd-accent-slate{--sd-accent:#64748b;}
.sd-dock{display:flex;align-items:center;gap:6px;padding:4px 16px;font:var(--dsw-font-xxs-12);line-height:16px;color:var(--dsw-alias-label-tertiary);}
.sd-dock-ref{font-family:var(--ds-font-family-code,monospace);font-size:12px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums;}
.sd-close-wrap{display:inline-flex;align-items:center;gap:8px;}
.sd-close-settled{font:var(--dsw-font-xxs-12);color:var(--dsw-alias-label-tertiary);}
.sd-close-error{font:var(--dsw-font-xxs-12);line-height:16px;color:var(--dsw-alias-state-error-primary);max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.sd-toolset{display:flex;flex-direction:column;gap:8px;min-width:0;}
.sd-toolset-body{display:flex;flex-direction:column;gap:8px;min-width:0;}
.sd-toolset-head{display:flex;align-items:center;gap:8px;flex-wrap:wrap;}
.sd-toolset-count{font:var(--dsw-font-xxxs-strong-11);line-height:16px;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums;}
.sd-toolset-grid{display:flex;flex-direction:column;gap:2px;max-height:240px;overflow-y:auto;padding:6px;border:1px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-sm,6px);background:var(--dsw-alias-bg-layer-1);scrollbar-color:var(--dsw-alias-scrollbar-bg-l2) transparent;}
.sd-tool{display:flex;align-items:center;gap:8px;padding:4px 6px;border-radius:var(--dsw-radius-xs,4px);font:var(--dsw-font-xxs-12);color:var(--dsw-alias-label-secondary);cursor:pointer;transition:background-color .15s ease,color .15s ease;}
.sd-tool:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary);}
.sd-tool input{accent-color:var(--dsw-alias-button-primary-fill);margin:0;flex:none;}
.sd-tool-name{min-width:0;overflow-wrap:anywhere;}
@media (max-width:900px){.sd-stats{grid-template-columns:repeat(2,minmax(0,1fr));}.sd-grid-3{grid-template-columns:repeat(2,minmax(0,1fr));}}
@media (max-width:720px){.sd-page-head{align-items:flex-start;}.sd-page-head .sd-actions{width:100%;}.sd-page-head .sd-actions .sd-btn{flex:1;}.sd-toolbar .sd-search-wrap{max-width:none;flex-basis:100%;}.sd-sort{flex:1;}.sd-dialog{max-height:none;width:100%;border-radius:0;}.sd-overlay{padding:0;align-items:stretch;}.sd-editor,.sd-import,.sd-confirm{height:100%;}.sd-dialog-body{max-height:none;flex:1;}.sd-card-grid{grid-template-columns:minmax(0,1fr);}}
@media (max-width:560px){.sd-stats{grid-template-columns:minmax(0,1fr);}.sd-grid-2,.sd-grid-3{grid-template-columns:minmax(0,1fr);}.sd-batchbar{align-items:flex-start;}.sd-batchbar .sd-actions{width:100%;}.sd-batchbar .sd-actions .sd-btn{flex:1;}}
@media (prefers-reduced-motion:reduce){.sd-card-tile,.sd-btn,.sd-icon-btn,.sd-segmented button,.sd-panel-chevron,.sd-dropzone{transition:none;}.sd-skeleton>div{animation:none;}.sd-card-tile.is-selectable:hover{transform:none;}}
`;

/** Inject the plugin stylesheet once. */
export function ensureUiStyles(): void {
  if (typeof document === 'undefined') return;
  if (document.querySelector(`style[data-plugin-css="${STYLE_TAG_ID}"]`) !== null) return;
  const tag = document.createElement('style');
  tag.dataset.plugin = 'dsh-plugin-subagent-director';
  tag.dataset.pluginCss = STYLE_TAG_ID;
  tag.textContent = uiCss;
  document.head.appendChild(tag);
}
