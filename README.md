# mcp-patchright

[![npm version](https://img.shields.io/npm/v/mcp-patchright)](https://www.npmjs.com/package/mcp-patchright)
[![license](https://img.shields.io/npm/l/mcp-patchright)](https://www.npmjs.com/package/mcp-patchright)

A Patchright-powered browser automation server for the
[Model Context Protocol](https://modelcontextprotocol.io). It gives agents 64
tools for navigation, page interaction, network inspection, storage, passkeys,
video, PDF export, and more.

Patchright removes several automation signals used by stock Playwright, such as
`Runtime.enable`, `Console.enable`, and `--enable-automation`. This reduces common
fingerprinting signals; it does not guarantee that a site will accept automated
traffic. Respect site terms, robots policies, and applicable law.

## Quick start

Requirements: Node.js 18 or newer and Google Chrome. The default browser session
uses installed Chrome in headed mode with a persistent profile.

Add the server to an MCP client:

```json
{
  "mcpServers": {
    "patchright": {
      "command": "npx",
      "args": ["-y", "mcp-patchright"]
    }
  }
}
```

Restart the client, then ask the agent to call `browser_start` and
`browser_navigate`.

To install the command globally instead:

```bash
npm install --global mcp-patchright
mcp-patchright --help
```

## What you get

- Persistent browser profiles and multi-tab control
- Token-efficient accessibility snapshots plus targeted `browser_find`
- CSS selector, aria-ref, and iframe-aware element actions
- Request tracking, offline mode, request blocking, and response mocking
- Cookie, localStorage, sessionStorage, and full storage-state tools
- Authenticated API requests that reuse browser cookies
- Device/mobile emulation, proxy, locale, timezone, and geolocation options
- Screenshots, PDF export, element highlights, and WebM recording
- CDP attachment to an existing Chrome session
- Virtual WebAuthn passkeys with private keys redacted by default

## Typical agent workflow

1. `browser_start`
2. `browser_navigate`
3. `browser_snapshot` or `browser_find`
4. Use returned `[ref=eN]` values with tools such as `browser_click`,
   `browser_fill`, and `browser_type`
5. `browser_close`

CSS selectors are also supported. Element tools accept exactly one of
`selector` or `ref`; pass `frameSelector` when the target is inside an iframe.

## Configuration

`browser_start` accepts per-session settings. Common examples:

```json
{
  "headless": true,
  "device": "iPhone 15",
  "locale": "en-US",
  "timezoneId": "America/New_York"
}
```

The defaults are:

| Setting | Default |
|---|---|
| Browser | Patchright Chromium using the `chrome` channel |
| Display | Headed |
| Profile | `~/.maestro/stealth-playwright-mcp/profiles/default` |
| Video directory | `~/.maestro/stealth-playwright-mcp/videos` |

Override the profile with `browser_start.userDataDir`, the
`--user-data-dir` CLI option, or `STEALTH_PLAYWRIGHT_USER_DATA_DIR`.

### Attach to an existing Chrome

Start Chrome with remote debugging and a separate profile:

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --remote-debugging-port=9222 \
  --user-data-dir="$HOME/.mcp-patchright/cdp-profile"
```

Then call:

```json
{ "cdpEndpoint": "http://127.0.0.1:9222" }
```

Video recording is unavailable when attached over CDP.

## HTTP mode

stdio is the simplest transport for a local MCP client. For a shared service,
start Streamable HTTP and legacy SSE endpoints explicitly:

```bash
npx -y mcp-patchright --host 127.0.0.1 --port 9321
```

- Streamable HTTP: `http://127.0.0.1:9321/mcp`
- SSE: `http://127.0.0.1:9321/sse`
- Health check: `http://127.0.0.1:9321/health`

Every HTTP client must provide a stable owner using `?owner=<id>` or the
`X-Browser-Owner` header. Owners isolate page access between callers. To close
one owner's tabs without stopping the browser:

```bash
curl -X DELETE "http://127.0.0.1:9321/owners?owner=my-agent"
```

Keep the default loopback host unless you have added authentication and network
controls in front of the server. Browser tools can access sensitive profiles and
arbitrary sites.

Run `mcp-patchright --help` for all CLI options, including headless mode, device
emulation, and output-size limits.

## Tool catalog

The server currently exposes 64 tools:

- **Session and pages:** `browser_start`, `browser_status`, `browser_close`,
  `browser_new_page`, `browser_pages`, `browser_switch_page`,
  `browser_close_page`
- **Navigation and discovery:** `browser_navigate`, `browser_navigate_back`,
  `browser_snapshot`, `browser_find`, `browser_wait_for`,
  `browser_get_visible_text`, `browser_get_visible_html`
- **Interaction:** `browser_click`, `browser_fill`, `browser_type`,
  `browser_hover`, `browser_press_key`, `browser_select_option`,
  `browser_handle_dialog`, `browser_file_upload`, `browser_resize`,
  `browser_drag`, `browser_fill_form`, `browser_iframe_click`,
  `browser_iframe_fill`
- **Execution and diagnostics:** `browser_evaluate`,
  `browser_run_code_unsafe`, `browser_fingerprint_check`,
  `browser_console_messages`
- **Network:** `browser_network_requests`, `browser_network_request`,
  `browser_network_state_set`, `browser_api_request`, `browser_route_block`,
  `browser_route_mock`, `browser_route_clear`
- **Session storage:** `browser_storage_save`, `browser_storage_load`
- **Cookies:** `browser_cookie_list`, `browser_cookie_get`,
  `browser_cookie_set`, `browser_cookie_delete`, `browser_cookie_clear`
- **Web storage:** `browser_localstorage_list`, `browser_localstorage_get`,
  `browser_localstorage_set`, `browser_localstorage_delete`,
  `browser_localstorage_clear`, `browser_sessionstorage_list`,
  `browser_sessionstorage_get`, `browser_sessionstorage_set`,
  `browser_sessionstorage_delete`, `browser_sessionstorage_clear`
- **Passkeys:** `browser_passkey_install`, `browser_passkey_create`,
  `browser_passkey_list`, `browser_passkey_delete`
- **Media and overlays:** `browser_take_screenshot`, `browser_save_pdf`,
  `browser_video_save`, `browser_highlight`, `browser_hide_highlight`

The MCP tool schemas contain the complete argument reference and are available
to clients through tool discovery.

## Development

```bash
git clone https://github.com/maestrojeong/mcp-patchright.git
cd mcp-patchright
npm install
npm run build
npm test
```

Useful commands:

```bash
npm run dev
npm run lint
npm run typecheck
npm run release:check  # clean install, lint, tests, and npm dry-run
```

## License

MIT
