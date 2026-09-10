const tabs = [...document.querySelectorAll('[role="tab"]')];

function activateTab(tab, focus = false) {
  for (const item of tabs) {
    const selected = item === tab;
    item.setAttribute("aria-selected", String(selected));
    item.tabIndex = selected ? 0 : -1;
    document.getElementById(item.getAttribute("aria-controls")).hidden =
      !selected;
  }
  if (focus) tab.focus();
}

for (const [index, tab] of tabs.entries()) {
  tab.addEventListener("click", () => activateTab(tab));
  tab.addEventListener("keydown", (event) => {
    let next;
    if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
    if (event.key === "ArrowLeft")
      next = (index - 1 + tabs.length) % tabs.length;
    if (event.key === "Home") next = 0;
    if (event.key === "End") next = tabs.length - 1;
    if (next !== undefined) {
      event.preventDefault();
      activateTab(tabs[next], true);
    }
  });
}

const copyButton = document.getElementById("copy-install");
const copyStatus = document.getElementById("copy-status");
copyButton.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(
      document.getElementById("install-commands").textContent,
    );
    copyStatus.textContent = "Commandes copiées.";
  } catch {
    copyStatus.textContent =
      "Copie indisponible. Sélectionnez les commandes pour les copier manuellement.";
  }
});
