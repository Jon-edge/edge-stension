## Edge Tools (edge-stension)

A VS Code extension that adds an "Edge Tools" activity bar with views to quickly browse and toggle various Edge development configurations

- **Views**: `Currency Plugins`, `Swap Plugins`, `Environment`
- **Quick actions**: enable/disable all, sort A→Z, favorites, filter
- **Environment**: toggles common boolean flags in `env.json`

### Requirements
- **VS Code**: >= 1.95.0

### Installation
- **From GitHub Release (recommended)**
  1. Download the `.vsix` from the repository [Releases page](https://github.com/Jon-edge/edge-stension/releases).
  2. In VS Code run: Extensions panel → `…` → `Install from VSIX…` → select the downloaded file.

- **From source (development)**
  1. Clone this repo and open it in VS Code
  2. Install deps and build:
     - `yarn`
     - `yarn compile`
  3. Press `F5` to launch the Extension Development Host

### Usage
- Open an edge-react-gui containing workspace or worktree
- Open the `Edge Tools` activity bar icon
- Use the toolbar actions and item context menus to:
  - Toggle individual plugins
  - Enable/disable all in a section
  - Filter and sort A→Z
  - Mark favorites
  - Flip environment booleans in `env.json`

### Configuration
No configuration needed. The extension looks for `src/util/corePlugins.ts` and `env.json` under the first matching workspace folder.

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
- `yarn release` — interactive script to bump version, commit, tag, and push

### Releases
Download the latest `.vsix` from the GitHub Releases page and install it in VS Code.

#### How to create a new release
Run `yarn release` and follow the prompts. This will:
1. Update version in `package.json`
2. Commit and push to `main`
3. Create and push the version tag (triggers the GitHub Actions workflow)
4. GitHub Actions builds and attaches the `.vsix` to the release

Release link: https://github.com/Jon-edge/edge-stension/releases

