import * as vscode from 'vscode'

// Baked-in relative path to corePlugins.ts within edge-react-gui
const CORE_PLUGINS_RELATIVE_PATH = 'src/util/corePlugins.ts'

let debugChannel: vscode.OutputChannel | undefined
function logDebug(message: string): void {
  const ts = new Date().toISOString()
  const line = `[${ts}] ${message}`
  if (debugChannel != null) debugChannel.appendLine(line)
  // Mirror to Extension Host log so you can always see it
  // (This shows up under Output → "Extension Host")
  // eslint-disable-next-line no-console
  console.log(`[Edge Tools] ${line}`)
}

// Multi-root helpers
function folderLooksLikeEdgeGui(folder: vscode.WorkspaceFolder): boolean {
  const name = folder.name.toLowerCase()
  const path = folder.uri.fsPath.toLowerCase()
  return name.includes('edge-react-gui') || path.includes('edge-react-gui')
}

async function fileExists(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(uri)
    return true
  } catch {
    return false
  }
}

async function readJsonFile<T = unknown>(uri: vscode.Uri): Promise<T | undefined> {
  try {
    const doc = await vscode.workspace.openTextDocument(uri)
    return JSON.parse(doc.getText()) as T
  } catch {
    return undefined
  }
}

async function selectEdgeGuiFolder(): Promise<vscode.WorkspaceFolder | undefined> {
  const folders = vscode.workspace.workspaceFolders ?? []
  if (folders.length === 0) return undefined
  const candidates: vscode.WorkspaceFolder[] = []
  logDebug(`Workspace folders: ${folders.map(f => `${f.name} -> ${f.uri.fsPath}`).join(' | ')}`)
  for (const folder of folders) {
    const pkg = await readJsonFile<{ name?: string }>(vscode.Uri.joinPath(folder.uri, 'package.json'))
    const pkgName = pkg?.name ?? '(none)'
    const hasCore = await fileExists(vscode.Uri.joinPath(folder.uri, CORE_PLUGINS_RELATIVE_PATH))
    const hasEnv = await fileExists(vscode.Uri.joinPath(folder.uri, 'env.json'))
    logDebug(`Check folder '${folder.name}': pkg.name='${pkgName}', core=${hasCore}, env=${hasEnv}`)
    if (hasCore && hasEnv) candidates.push(folder)
  }
  if (candidates.length === 1) return candidates[0]
  if (candidates.length > 1) {
    vscode.window.showErrorMessage('Multiple edge-react-gui folders detected (contain both corePlugins.ts and env.json). Please keep only one open.')
    logDebug(`Error: multiple candidates: ${candidates.map(c => c.uri.fsPath).join(' | ')}`)
    return undefined
  }
  vscode.window.showErrorMessage('Could not locate edge-react-gui. Ensure one workspace folder contains src/util/corePlugins.ts and env.json.')
  logDebug('Error: no candidates found for edge-react-gui')
  return undefined
}

async function findDocInEdgeGui(relativePath: string): Promise<vscode.TextDocument | undefined> {
  const folder = await selectEdgeGuiFolder()
  if (folder == null) return undefined
  const uri = vscode.Uri.joinPath(folder.uri, relativePath)
  try {
    logDebug(`Opening document: ${uri.fsPath}`)
    return await vscode.workspace.openTextDocument(uri)
  } catch {
    logDebug(`Open failed (not found): ${uri.fsPath}`)
    return undefined
  }
}

export function activate(context: vscode.ExtensionContext) {
  debugChannel = vscode.window.createOutputChannel('Edge Tools')
  // Surface the channel at least once so it's easy to find
  debugChannel.show(true)
  logDebug('Extension activated')
  const currencyProvider = new PluginTreeProvider('currency')
  const swapProvider = new PluginTreeProvider('swap')
  const environmentProvider = new EnvironmentTreeProvider()

  // Load persisted favorites (workspace-scoped)
  const persistedFavs = context.workspaceState.get<string[]>('edge.favorites', [])
  currencyProvider.setFavorites(persistedFavs)
  swapProvider.setFavorites(persistedFavs)
  context.subscriptions.push(
    vscode.window.createTreeView('edgeCurrencyPluginsView', {
      treeDataProvider: currencyProvider,
      showCollapseAll: true
    })
  )
  context.subscriptions.push(
    vscode.window.createTreeView('edgeSwapPluginsView', {
      treeDataProvider: swapProvider,
      showCollapseAll: true
    })
  )
  context.subscriptions.push(
    vscode.window.createTreeView('edgeEnvironmentView', {
      treeDataProvider: environmentProvider,
      showCollapseAll: false
    })
  )

  // QuickPick toggle (kept as a convenience)
  context.subscriptions.push(
    vscode.commands.registerCommand('edge.toggleCorePlugin', async () => {
      const { entries } = await readPluginsOrShowError()
      if (entries.length === 0) return

      const pick = await vscode.window.showQuickPick(
        entries.map(e => ({
          label: e.key,
          description: `${e.section} • ${e.enabled ? 'enabled' : 'disabled'}`
        })),
        { placeHolder: 'Select a plugin to toggle' }
      )
      if (pick == null) return
      const entry = entries.find(e => e.key === pick.label)
      if (entry == null) return
      await setPluginEnabled(entry, !entry.enabled)
      currencyProvider.refresh();
      swapProvider.refresh()
    })
  )

  // Click a row to toggle
  context.subscriptions.push(
    vscode.commands.registerCommand('edge.togglePlugin', async (item?: PluginItem) => {
      if (item == null || item.kind !== 'plugin') return
      await setPluginEnabled(item.entry, !item.entry.enabled)
      currencyProvider.refresh();
      swapProvider.refresh();
      void updateContextKeys()
    })
  )

  // Section-wide toggles are handled by per-view toolbar commands now

  // Title action to refresh
  context.subscriptions.push(
    vscode.commands.registerCommand('edge.refreshCurrencyPlugins', () => currencyProvider.refresh())
  )
  context.subscriptions.push(
    vscode.commands.registerCommand('edge.refreshSwapPlugins', () => swapProvider.refresh())
  )
  context.subscriptions.push(
    vscode.commands.registerCommand('edge.refreshEnvironment', () => environmentProvider.refresh())
  )
  // Dynamic title buttons (context keys) using setContext
  async function updateContextKeys(): Promise<void> {
    const { entries } = await readPluginsOrShowError()
    const cur = entries.filter(e => e.section === 'currency')
    const sw = entries.filter(e => e.section === 'swap')
    const curAll = cur.length > 0 && cur.every(e => e.enabled)
    const swAll = sw.length > 0 && sw.every(e => e.enabled)
    await vscode.commands.executeCommand('setContext', 'edge.currencyAllEnabled', curAll)
    await vscode.commands.executeCommand('setContext', 'edge.swapAllEnabled', swAll)
  }
  // Filter context keys
  let currencyFilter: string | undefined
  let swapFilter: string | undefined
  async function updateFilterContext(): Promise<void> {
    await vscode.commands.executeCommand('setContext', 'edge.currencyFilterActive', Boolean(currencyFilter && currencyFilter.length > 0))
    await vscode.commands.executeCommand('setContext', 'edge.swapFilterActive', Boolean(swapFilter && swapFilter.length > 0))
  }
  void updateContextKeys(); void updateFilterContext()
  context.subscriptions.push(
    vscode.commands.registerCommand('edge.toggleAllCurrency', async () => {
      const { entries } = await readPluginsOrShowError()
      const filtered = entries.filter(e => e.section === 'currency')
      if (filtered.length === 0) return
      const allEnabled = filtered.every(e => e.enabled)
      await setSectionEnabled('currency', !allEnabled)
      currencyProvider.refresh();
      swapProvider.refresh()
      void updateContextKeys()
    })
  )
  context.subscriptions.push(
    vscode.commands.registerCommand('edge.toggleAllSwap', async () => {
      const { entries } = await readPluginsOrShowError()
      const filtered = entries.filter(e => e.section === 'swap')
      if (filtered.length === 0) return
      const allEnabled = filtered.every(e => e.enabled)
      await setSectionEnabled('swap', !allEnabled)
      currencyProvider.refresh();
      swapProvider.refresh()
      void updateContextKeys()
    })
  )
  context.subscriptions.push(
    vscode.commands.registerCommand('edge.enableAllCurrency', async () => {
      await setSectionEnabled('currency', true)
      currencyProvider.refresh(); swapProvider.refresh(); void updateContextKeys()
    })
  )
  context.subscriptions.push(
    vscode.commands.registerCommand('edge.disableAllCurrency', async () => {
      await setSectionEnabled('currency', false)
      currencyProvider.refresh(); swapProvider.refresh(); void updateContextKeys()
    })
  )
  context.subscriptions.push(
    vscode.commands.registerCommand('edge.enableAllSwap', async () => {
      await setSectionEnabled('swap', true)
      currencyProvider.refresh(); swapProvider.refresh(); void updateContextKeys()
    })
  )
  context.subscriptions.push(
    vscode.commands.registerCommand('edge.disableAllSwap', async () => {
      await setSectionEnabled('swap', false)
      currencyProvider.refresh(); swapProvider.refresh(); void updateContextKeys()
    })
  )
  // Filter handlers
  context.subscriptions.push(
    vscode.commands.registerCommand('edge.filterCurrency', async () => {
      const value = await vscode.window.showInputBox({ prompt: 'Filter currency plugins' })
      currencyFilter = value ?? undefined
      currencyProvider.setFilter(currencyFilter)
      await updateFilterContext()
    })
  )
  context.subscriptions.push(
    vscode.commands.registerCommand('edge.clearCurrencyFilter', async () => {
      currencyFilter = undefined
      currencyProvider.setFilter(undefined)
      await updateFilterContext()
    })
  )
  context.subscriptions.push(
    vscode.commands.registerCommand('edge.filterSwap', async () => {
      const value = await vscode.window.showInputBox({ prompt: 'Filter swap plugins' })
      swapFilter = value ?? undefined
      swapProvider.setFilter(swapFilter)
      await updateFilterContext()
    })
  )
  context.subscriptions.push(
    vscode.commands.registerCommand('edge.clearSwapFilter', async () => {
      swapFilter = undefined
      swapProvider.setFilter(undefined)
      await updateFilterContext()
    })
  )
  // Favorites
  context.subscriptions.push(
    vscode.commands.registerCommand('edge.toggleFavorite', (item?: PluginItem) => {
      if (item == null || item.kind !== 'plugin') return
      const favKey = `${item.entry.section}:${item.entry.key}`
      if (item.entry.section === 'currency') currencyProvider.toggleFavorite(favKey)
      else swapProvider.toggleFavorite(favKey)
      // Persist combined favorites after toggle
      const combinedFavs = Array.from(
        new Set([
          ...currencyProvider.getFavoriteKeys(),
          ...swapProvider.getFavoriteKeys()
        ])
      )
      void context.workspaceState.update('edge.favorites', combinedFavs)
    })
  )
  // Environment toggles
  context.subscriptions.push(
    vscode.commands.registerCommand('edge.env.toggleKey', async (item?: EnvItem) => {
      if (item == null) return
      await toggleEnvBoolean(item.key)
      environmentProvider.refresh()
      // Also update plugin views' toolbar states in case they depend on DEBUG flags
      await vscode.commands.executeCommand('setContext', 'edge.currencyAllEnabled', undefined)
      await vscode.commands.executeCommand('setContext', 'edge.swapAllEnabled', undefined)
    })
  )
}

export function deactivate() {}

type Section = 'currency' | 'swap'

interface PluginLine {
  key: string
  enabled: boolean
  section: Section
  lineStart: number
  lineEnd: number
}

// Tree-based implementation
type PluginItem =
  | { kind: 'group'; label: 'Favorites' | 'Enabled' | 'Disabled' }
  | { kind: 'plugin'; entry: PluginLine }

class PluginTreeProvider implements vscode.TreeDataProvider<PluginItem> {
  private filterText: string | undefined
  private favorites = new Set<string>()
  private sortAZ = true
  constructor(private readonly onlySection?: Section) {}
  private readonly emitter = new vscode.EventEmitter<void>()
  readonly onDidChangeTreeData = this.emitter.event

  setFilter(text: string | undefined): void {
    this.filterText = text?.toLowerCase().trim() || undefined
    this.refresh()
  }

  // Sorting defaults to A→Z
  toggleFavorite(key: string): void { this.favorites.has(key) ? this.favorites.delete(key) : this.favorites.add(key); this.refresh() }

  setFavorites(keys: string[]): void {
    this.favorites = new Set(keys)
    this.refresh()
  }

  getFavoriteKeys(): string[] {
    return Array.from(this.favorites)
  }

  async getChildren(element?: PluginItem): Promise<PluginItem[]> {
    const { entries } = await readPluginsOrShowError()
    if (entries.length === 0) return []
    if (element == null) {
      if (this.onlySection != null) {
        return [
          { kind: 'group', label: 'Favorites' },
          { kind: 'group', label: 'Enabled' },
          { kind: 'group', label: 'Disabled' }
        ]
      }
      return []
    }
    if (element.kind === 'group') {
      let list = entries.filter(e => e.section === this.onlySection)
      if (this.filterText != null) list = list.filter(e => e.key.toLowerCase().includes(this.filterText!))
      if (element.label === 'Favorites') list = list.filter(e => this.favorites.has(this.makeFavKey(e)))
      if (element.label === 'Enabled') list = list.filter(e => e.enabled)
      if (element.label === 'Disabled') list = list.filter(e => !e.enabled)
      if (this.sortAZ) list = list.slice().sort((a,b) => a.key.localeCompare(b.key))
      return list.map(e => ({ kind: 'plugin', entry: e }))
    }
    return []
  }

  getTreeItem(element: PluginItem): vscode.TreeItem {
    if (element.kind === 'group') {
      return new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.Expanded)
    }
    const { entry } = element
    const item = new vscode.TreeItem(entry.key)
    // Simulated checkbox with codicons
    item.iconPath = new vscode.ThemeIcon(entry.enabled ? 'check' : 'circle-large-outline')
    item.tooltip = `${entry.section} • ${entry.enabled ? 'enabled' : 'disabled'}`
    item.contextValue = this.favorites.has(this.makeFavKey(entry)) ? 'pluginFav' : 'pluginUnfav'
    item.command = {
      command: 'edge.togglePlugin',
      title: 'Toggle',
      arguments: [element]
    }
    return item
  }

  refresh(): void {
    this.emitter.fire()
  }

  private computeSectionState(section: Section): 'all' | 'none' | 'mixed' {
    const entries = this.readEntriesSync()
    const filtered = entries.filter(e => e.section === section)
    if (filtered.length === 0) return 'none'
    const enabled = filtered.filter(e => e.enabled).length
    if (enabled === 0) return 'none'
    if (enabled === filtered.length) return 'all'
    return 'mixed'
  }

  private readEntriesSync(): PluginLine[] {
    const folders = vscode.workspace.workspaceFolders ?? []
    for (const folder of folders) {
      const fileUri = vscode.Uri.joinPath(folder.uri, CORE_PLUGINS_RELATIVE_PATH)
      const openDoc = vscode.workspace.textDocuments.find(d => d.uri.toString() === fileUri.toString())
      if (openDoc != null) return extractPluginLines(openDoc.getText())
    }
    return []
  }

  private makeFavKey(e: PluginLine): string { return `${e.section}:${e.key}` }
}

// Environment view
type EnvItem = { key: string; value: boolean }

class EnvironmentTreeProvider implements vscode.TreeDataProvider<EnvItem> {
  private readonly emitter = new vscode.EventEmitter<void>()
  readonly onDidChangeTreeData = this.emitter.event

  getTreeItem(element: EnvItem): vscode.TreeItem {
    const item = new vscode.TreeItem(element.key)
    item.iconPath = new vscode.ThemeIcon(element.value ? 'check' : 'circle-large-outline')
    item.command = { command: 'edge.env.toggleKey', title: 'Toggle', arguments: [element] }
    return item
  }

  async getChildren(): Promise<EnvItem[]> {
    const env = await readEnvBooleans()
    const keys = [
      'DEBUG_PLUGINS',
      'DEBUG_CORE',
      'DEBUG_CURRENCY_PLUGINS',
      'DEBUG_ACCOUNTBASED',
      'DEBUG_EXCHANGES',
      'DEBUG_LOGBOX',
      'USE_FAKE_CORE'
    ].slice().sort((a, b) => a.localeCompare(b))
    return keys.map(key => ({ key, value: env[key] === true }))
  }

  refresh(): void {
    this.emitter.fire()
  }
}

async function readPluginsOrShowError(): Promise<{ doc: vscode.TextDocument | undefined; entries: PluginLine[] }> {
  if (vscode.workspace.workspaceFolders == null || vscode.workspace.workspaceFolders.length === 0) {
    vscode.window.showErrorMessage('Open a workspace containing edge-react-gui (with corePlugins.ts).')
    return { doc: undefined, entries: [] }
  }
  const doc = await findDocInEdgeGui(CORE_PLUGINS_RELATIVE_PATH)
  if (doc == null) {
    vscode.window.showErrorMessage(`File not found in any workspace folder: ${CORE_PLUGINS_RELATIVE_PATH}`)
    logDebug(`Error: corePlugins not found: ${CORE_PLUGINS_RELATIVE_PATH}`)
    return { doc: undefined, entries: [] }
  }
  const text = doc.getText()
  let entries = extractPluginLines(text)
  if (entries.length === 0) {
    vscode.window.showErrorMessage('No plugin entries found in currencyPlugins/swapPlugins.')
    logDebug('Warning: No plugin entries found in parsed corePlugins.ts')
  }
  // Overlay enabled state from env filter lists, not from commented lines:
  const filters = await readEnvFilters()
  entries = applyFiltersToEntries(entries, filters)
  logDebug(`Parsed corePlugins.ts at ${doc.uri.fsPath}, entries=${entries.length}`)
  return { doc, entries }
}

// Env-based toggling
async function setPluginEnabled(target: PluginLine, enable: boolean): Promise<void> {
  const { entries } = await readPluginsOrShowError()
  if (entries.length === 0) return
  const sectionEntries = entries.filter(e => e.section === target.section)
  const keys = sectionEntries.map(e => e.key)
  const filters = await readEnvFilters()
  const { currency, swap } = filters
  const arr = target.section === 'currency' ? currency.slice() : swap.slice()
  const isNoFilter = arr.length === 0
  const alreadyEnabled = isNoFilter || arr.includes(target.key)
  if (enable) {
    if (alreadyEnabled) return
    arr.push(target.key)
    // If all keys are included, compress to [] (no filtering)
    if (arr.length >= keys.length && keys.every(k => arr.includes(k))) arr.length = 0
  } else {
    if (!alreadyEnabled && arr.length > 0) return
    if (isNoFilter) {
      // Start from all enabled, remove the target
      for (const k of keys) if (k !== target.key) arr.push(k)
    } else {
      const idx = arr.indexOf(target.key)
      if (idx >= 0) arr.splice(idx, 1)
    }
    // If removing results in including none, use a sentinel to keep filtering active
    if (arr.length === 0) arr.push('__none__')
  }
  await writeEnvFilters(target.section, arr)
}

// Enable/disable entire section via filters
async function setSectionEnabled(section: Section, enable: boolean): Promise<void> {
  if (enable) {
    await writeEnvFilters(section, [])
  } else {
    // Non-empty array with sentinel disables all effectively
    await writeEnvFilters(section, ['__none__'])
  }
}

// Apply filters to entries to derive enabled status
function applyFiltersToEntries(entries: PluginLine[], filters: { currency: string[]; swap: string[] }): PluginLine[] {
  const cur = filters.currency
  const sw = filters.swap
  const curNoFilter = cur.length === 0
  const swNoFilter = sw.length === 0
  return entries.map(e => ({
    ...e,
    enabled: e.section === 'currency' ? (curNoFilter ? true : cur.includes(e.key)) : (swNoFilter ? true : sw.includes(e.key))
  }))
}

// Batch version: apply all comment toggles and comma fixes in ONE edit + ONE save
async function setSectionEnabledBatch(section: Section, enable: boolean): Promise<void> {
  const { doc, entries } = await readPluginsOrShowError()
  if (doc == null || entries.length === 0) return
  const sectionEntries = entries
    .filter(e => e.section === section)
    .sort((a, b) => a.lineStart - b.lineStart)

  // Compute which lines will be enabled after the change
  const enabledAfter = sectionEntries.filter(e => enable)

  const edit = new vscode.WorkspaceEdit()
  for (let i = 0; i < sectionEntries.length; i++) {
    const e = sectionEntries[i]
    const range = new vscode.Range(doc.positionAt(e.lineStart), doc.positionAt(e.lineEnd))
    const original = doc.getText(range)
    let updated = setCommentState(original, enable)
    if (enable) {
      const isLast = enabledAfter[enabledAfter.length - 1]?.key === e.key
      updated = isLast ? removeTrailingComma(updated) : ensureTrailingComma(updated)
    }
    if (updated !== original) edit.replace(doc.uri, range, updated)
  }
  if (edit.size > 0) {
    await vscode.workspace.applyEdit(edit)
    await doc.save()
  }
}

function toggleComment(line: string): string {
  const m = line.match(/^(\s*)(\/\/\s*)?(.*)$/)
  if (m == null) return line
  const indent = m[1]
  const hasComment = m[2] != null
  const rest = m[3]
  return hasComment ? `${indent}${rest}` : `${indent}// ${rest}`
}

function setCommentState(line: string, enable: boolean): string {
  const m = line.match(/^(\s*)(\/\/\s*)?(.*)$/)
  if (m == null) return line
  const indent = m[1]
  const hasComment = m[2] != null
  const rest = m[3]
  if (enable) return hasComment ? `${indent}${rest}` : line
  return hasComment ? line : `${indent}// ${rest}`
}

function extractPluginLines(text: string): PluginLine[] {
  const out: PluginLine[] = []
  const sections: Array<{ name: string; section: Section }> = [
    { name: 'currencyPlugins', section: 'currency' },
    { name: 'swapPlugins', section: 'swap' }
  ]
  for (const cfg of sections) {
    const block = findObjectBlock(text, cfg.name)
    if (block == null) continue
    const { start, end } = block
    const snippet = text.slice(start, end)
    let offset = start
    for (const line of snippet.split('\n')) {
      const m = line.match(/^(\s*)(\/\/\s*)?(["']?[\w.-]+["']?)\s*:/)
      // Only include uncommented lines as toggleable entries
      if (m != null && m[2] == null) {
        const rawKey = m[3]
        const key = rawKey.replace(/^[\'\"]|[\'\"]$/g, '')
        const enabled = true
        out.push({
          key,
          enabled,
          section: cfg.section,
          lineStart: offset,
          lineEnd: offset + line.length
        })
      }
      offset += line.length + 1
    }
  }
  return out
}

function findObjectBlock(text: string, constName: string): { start: number; end: number } | null {
  const anchor = text.indexOf(`export const ${constName}`)
  if (anchor < 0) return null
  const open = text.indexOf('{', anchor)
  if (open < 0) return null
  let depth = 0
  for (let i = open; i < text.length; i++) {
    const ch = text[i]
    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) return { start: open + 1, end: i }
    }
  }
  return null
}

// Ensure `import { ENV } from '../env'` exists in corePlugins.ts
async function ensureEnvImportPresent(doc: vscode.TextDocument): Promise<void> {
  const text = doc.getText()
  const hasImport = /\bimport\s*\{\s*ENV\s*\}\s*from\s*['"]\.\.\/env['"];?/.test(text)
  if (hasImport) return
  // Insert after the last top-level import; fallback to top of file
  const importMatches = Array.from(text.matchAll(/^import\s.*$/gm))
  let insertPos = 0
  if (importMatches.length > 0) {
    const last = importMatches[importMatches.length - 1]
    insertPos = (last.index ?? 0) + last[0].length
    // move past trailing newline if present
    if (text[insertPos] === '\n') insertPos += 1
  }
  const edit = new vscode.WorkspaceEdit()
  edit.insert(doc.uri, doc.positionAt(insertPos), "import { ENV } from '../env'\n")
  await vscode.workspace.applyEdit(edit)
  await doc.save()
  logDebug(`Inserted missing ENV import into ${doc.uri.fsPath}`)
}

async function fixCommasForSection(section: Section): Promise<void> {
  const { doc, entries } = await readPluginsOrShowError()
  if (doc == null || entries.length === 0) return
  const enabled = entries
    .filter(e => e.section === section && e.enabled)
    .sort((a, b) => a.lineStart - b.lineStart)
  if (enabled.length === 0) return

  const edit = new vscode.WorkspaceEdit()
  for (let i = 0; i < enabled.length; i++) {
    const e = enabled[i]
    const isLast = i === enabled.length - 1
    const range = new vscode.Range(doc.positionAt(e.lineStart), doc.positionAt(e.lineEnd))
    const line = doc.getText(range)
    const updated = isLast ? removeTrailingComma(line) : ensureTrailingComma(line)
    if (updated !== line) edit.replace(doc.uri, range, updated)
  }
  if (edit.size > 0) {
    await vscode.workspace.applyEdit(edit)
    await doc.save()
  }
}

function ensureTrailingComma(line: string): string {
  if (/,\s*$/.test(line)) return line
  return line.replace(/\s*$/, ',')
}

function removeTrailingComma(line: string): string {
  return line.replace(/,\s*$/, '')
}

// Environment helpers
type EnvJson = Record<string, unknown>

async function readEnvBooleans(): Promise<Record<string, boolean>> {
  const doc = await findDocInEdgeGui('env.json')
  if (doc == null) return {}
  logDebug(`Reading env.json at ${doc.uri.fsPath}`)
  const json = JSON.parse(doc.getText()) as EnvJson
  const out: Record<string, boolean> = {}
  for (const [k, v] of Object.entries(json)) {
    if (typeof v === 'boolean') out[k] = v
  }
  return out
}

async function toggleEnvBoolean(key: string): Promise<void> {
  const doc = await findDocInEdgeGui('env.json')
  if (doc == null) return
  const envUri = doc.uri
  const text = doc.getText()
  const regex = new RegExp(`(\\"${key}\\"\\s*:\\s*)(true|false)`, 'g')
  const newText = text.replace(regex, (_m, p1, p2) => `${p1}${p2 === 'true' ? 'false' : 'true'}`)
  if (newText === text) return
  const edit = new vscode.WorkspaceEdit()
  edit.replace(envUri, new vscode.Range(doc.positionAt(0), doc.positionAt(text.length)), newText)
  await vscode.workspace.applyEdit(edit)
  await doc.save()
  logDebug(`Toggled env key '${key}' in ${envUri.fsPath}`)
}

// Read/write FILTER_* arrays from env.json
async function readEnvFilters(): Promise<{ currency: string[]; swap: string[] }> {
  const doc = await findDocInEdgeGui('env.json')
  if (doc == null) return { currency: [], swap: [] }
  let json: EnvJson
  try {
    json = JSON.parse(doc.getText()) as EnvJson
  } catch {
    return { currency: [], swap: [] }
  }
  const toArray = (v: unknown): string[] => (Array.isArray(v) ? v.filter(x => typeof x === 'string') as string[] : [])
  const currency = toArray((json as any).FILTER_CURRENCY_PLUGINS)
  const swap = toArray((json as any).FILTER_SWAP_PLUGINS)
  return { currency, swap }
}

async function writeEnvFilters(section: Section, allowList: string[]): Promise<void> {
  const doc = await findDocInEdgeGui('env.json')
  if (doc == null) return
  let json: EnvJson
  try {
    json = JSON.parse(doc.getText()) as EnvJson
  } catch {
    json = {}
  }
  const key = section === 'currency' ? 'FILTER_CURRENCY_PLUGINS' : 'FILTER_SWAP_PLUGINS'
  const unique = Array.from(new Set(allowList.filter(s => typeof s === 'string')))
  ;(json as any)[key] = unique
  const newText = JSON.stringify(json, null, 2) + '\n'
  const envUri = doc.uri
  const edit = new vscode.WorkspaceEdit()
  edit.replace(envUri, new vscode.Range(doc.positionAt(0), doc.positionAt(doc.getText().length)), newText)
  await vscode.workspace.applyEdit(edit)
  await doc.save()
  logDebug(`Updated ${key} in ${envUri.fsPath}: ${JSON.stringify(unique)}`)
}
