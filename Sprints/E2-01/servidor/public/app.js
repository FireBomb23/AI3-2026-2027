// Módulo principal da PWA Reporta (Sprint E2-01: registo provisório do Service Worker)

async function registarServiceWorker() {
  const elementoEstado = document.getElementById('estado-sw');

  if (!('serviceWorker' in navigator)) {
    if (elementoEstado) {
      elementoEstado.textContent = 'Service Worker não suportado neste browser.';
    }
    return;
  }

  try {
    const registo = await navigator.serviceWorker.register('/sw.js');
    console.log('[Reporta] Service Worker registado:', registo.scope);
    if (elementoEstado) {
      elementoEstado.textContent = `Service Worker registado (${registo.scope}).`;
    }
  } catch (erro) {
    console.error('[Reporta] Erro ao registar Service Worker:', erro);
    if (elementoEstado) {
      elementoEstado.textContent = `Falha no registo do Service Worker: ${erro.message}`;
    }
  }
}

window.addEventListener('load', () => {
  registarServiceWorker();
});
