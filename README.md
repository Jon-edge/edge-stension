## Edge Core Plugins Toggle

A VS Code extension that adds an "Edge Plugins" activity bar with views to quickly browse and toggle Edge core currency/swap plugins and flip environment booleans.

- **Views**: `Currency Plugins`, `Swap Plugins`, `Environment`
- **Quick actions**: enable/disable all, sort A→Z, favorites, filter
- **Environment**: toggles common boolean flags in `env.json`

### Requirements
- **VS Code**: >= 1.95.0
- Open the Edge React GUI workspace so the extension can find `env.json` and your `corePlugins.ts` file.

### Installation
- **From GitHub Release (recommended)**
  1. Download the `.vsix` from the repository Releases page.
  2. In VS Code run: Extensions panel → `…` → `Install from VSIX…` → select the downloaded file.

- **From source (development)**
  1. Clone this repo and open it in VS Code
  2. Install deps and build:
     - `yarn`
     - `yarn compile`
  3. Press `F5` to launch the Extension Development Host

### Usage
- Open your Edge React GUI project in VS Code (as the workspace root)
- Open the `Edge Plugins` activity bar icon
- Use the toolbar actions and item context menus to:
  - Toggle individual plugins
  - Enable/disable all in a section
  - Filter and sort A→Z
  - Mark favorites
  - Flip environment booleans in `env.json`

### Configuration
- **edge.corePlugins.relativePath**: Relative path (from workspace root) to your `corePlugins.ts` file.

```json
{
  "edge.corePlugins.relativePath": "src/util/corePlugins.ts"
}
```

### Commands
- `edge.toggleCorePlugin`
- `edge.togglePlugin`
- `edge.refreshCurrencyPlugins`, `edge.refreshSwapPlugins`, `edge.refreshEnvironment`
- `edge.toggleAllCurrency`, `edge.toggleAllSwap`
- `edge.enableAllCurrency`, `edge.disableAllCurrency`
- `edge.enableAllSwap`, `edge.disableAllSwap`
- `edge.filterCurrency`, `edge.clearCurrencyFilter`
- `edge.filterSwap`, `edge.clearSwapFilter`
- `edge.env.toggleKey`

### Scripts
- `yarn compile` — build TypeScript into `out/`
- `yarn watch` — watch and rebuild during development

### Releases
Download the latest `.vsix` from the GitHub Releases page and install it in VS Code.

