/**
 * dsh-llm-multimodal — client half (browser).
 *
 * No client-side UI in this build. Manual provider configuration has been
 * paused (see the host half's note about the persistence path). All user-
 * facing wiring lives in the host tools' error messages — when no model is
 * auto-discoverable, the tool returns a Chinese hint pointing the user at
 * 「设置 > 模型」.
 *
 * We still ship a `apply` because the loader entry requires it (the
 * `__ModuleLoader__.load({ id, factory })` contract validates that the
 * returned plugin has an `apply` function). The body is a no-op when no
 * services of interest are present.
 */

window.__ModuleLoader__.load({
  id: "dsh-llm-multimodal",
  factory: (require) => {
    return { name: "dsh-llm-multimodal", apply };
    async function apply(_ctx) {
      // Intentionally empty. The host half registers the two tools; the
      // browser-side rendering of the settings section is disabled until
      // the settings-update persistence path is repaired.
    }
  },
});
