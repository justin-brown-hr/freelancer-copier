const DEFAULTS = { format: "text", includeDescription: true };

const formatInputs = [...document.querySelectorAll('input[name="format"]')];
const includeDescription = document.getElementById("includeDescription");

chrome.storage.sync.get(DEFAULTS, (v) => {
  formatInputs.forEach((i) => (i.checked = i.value === v.format));
  includeDescription.checked = v.includeDescription;
});

formatInputs.forEach((input) =>
  input.addEventListener("change", () => {
    if (input.checked) chrome.storage.sync.set({ format: input.value });
  })
);

includeDescription.addEventListener("change", () =>
  chrome.storage.sync.set({ includeDescription: includeDescription.checked })
);
