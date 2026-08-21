function settingsScript(_egret: any, $self: any) {
  $self.getChild("@saveProfileBtn")?.listen({
    onClick: async () => {
      const field = $self.getChild("@form-name-value");
      const name = String(
        field?.getProps()?.value ?? $self.getProps()?.profileName ?? "",
      ).trim();
      $self.getChild("@profile-status")?.setProps({
        text: "Saving…",
      });
      try {
        const result = await $self.actions.updateProfile({ name });
        $self.setProps({
          profileName: result.profileName,
          profileEmail: result.profileEmail,
          profileRole: result.profileRole,
        });
        field?.setProps({ value: result.profileName });
        $self.getChild("@profile-status")?.setProps({
          text: "Saved on the server.",
        });
      } catch (error) {
        console.error("[settings] updateProfile failed", error);
        $self.getChild("@profile-status")?.setProps({
          text: "Could not save profile.",
        });
      }
    },
  });
}

export default settingsScript;
