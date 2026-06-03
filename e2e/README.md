# E2E de Eco

Pruebas end-to-end contra los servicios de **producción** del ecosistema. No usan
el navegador: replican el `signData` del vault (ECDSA P-256, serialización
canónica, firma raw `ieee-p1363` en base64) e inyectan esa identidad en los
**paquetes reales** del ecosistema, ejercitando los servicios como lo hace Eco.

```bash
node e2e/geo.mjs     # geo.closer.click: publicar / descubrir / overwrite / anti-replay / retirar + reputación health
node e2e/proxy.mjs   # proxy.closer.click: identify firmado / envío dirigido (reply-reeco) / cola offline 24h
```

Cobertura:

- **geo** — `publishPin` → `queryRadius` round-trip (payload/tags/distancia), un
  pin por identidad con overwrite (rehidratación del beacon), rechazo por
  `issuedAt` fuera de ventana (anti-replay) y `removePin`.
- **proxy** — `connect` + `identify` con sobre firmado, `sendByPubkey` dirigido
  (B recibe con `fromPubkey`), y entrega encolada a un destinatario offline.
- **reputación** — `/health`.

No cubierto headless (son iframes de navegador, requieren sesión real):

- **vault** `id.closer.click` — firma/afinidad/nickname. En la app se prueba en
  navegador con el vault logueado.
- **store** `store.closer.click` — persistencia local (IndexedDB + postMessage).
