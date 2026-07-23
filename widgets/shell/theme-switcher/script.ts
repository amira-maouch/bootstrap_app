const themeSwitcherScript = ($egret: EgretRuntime, $self: ThemeSwitcherSelf) => {
  const themeApi = $egret.theme;
  if (!themeApi) return;

  const themeSelect = $self.getChild("@themeSelect");
  const modeToggle = $self.getChild("@modeToggle");
  const modeIcon = $self.getChild("@modeIcon");

  const updateModeIcon = (mode: "light" | "dark") => {
    modeIcon?.setProps({ text: mode === "dark" ? "🌙" : "☀️" });
  };

  // ── Initialise select to the currently active theme ───────────────────────
  const state = themeApi.getState();
  themeSelect?.setProps({
    value: state.currentTheme,
    onChange: (e: Event) => {
      const value = (e.target as HTMLSelectElement).value;
      themeApi.setTheme(value);
      // sync the controlled select back to the newly selected value
      themeSelect?.setProps({ value });
      $self.emit("theme:changed", {
        theme: value,
        mode: themeApi.getState().currentMode,
      });
    },
  });
  updateModeIcon(state.currentMode);

  // ── Light / dark toggle ───────────────────────────────────────────────────
  modeToggle?.listen({
    onClick: () => {
      themeApi.toggleMode();
      const newState = themeApi.getState();
      updateModeIcon(newState.currentMode);
      $self.emit("theme:changed", {
        theme: newState.currentTheme,
        mode: newState.currentMode,
      });
    },
  });

  // ── Public API (mirrors alefbab's theme-switcher) ─────────────────────────
  $self.registerMethod("setTheme", (theme: string, mode?: "light" | "dark") => {
    themeApi.setTheme(theme, mode);
    themeSelect?.setProps({ value: theme });
    updateModeIcon(themeApi.getState().currentMode);
  });
};

export default themeSwitcherScript;
