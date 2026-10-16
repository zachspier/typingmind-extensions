(function () {
  const style = document.createElement('style');
  style.id = 'codeblock-wrap';
  style.textContent = `
    pre, pre code {
      white-space: pre-wrap !important;
      overflow-wrap: anywhere !important;
      word-break: break-word !important;
      overflow-x: visible !important;
    }
  `;
  document.head.appendChild(style);
})();
