import * as vscode from 'vscode'

export function activate(context: vscode.ExtensionContext) {
  const currencyProvider = new PluginTreeProvider('currency')
  const swapProvider = new PluginTreeProvider('swap')
  const environmentProvider = new EnvironmentTreeProvider()
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
      const { doc, entries } = await readPluginsOrShowError()
      if (doc == null || entries.length === 0) return

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
      await togglePluginLine(entry)
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
      await setSectionEnabledBatch('currency', !allEnabled)
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
      await setSectionEnabledBatch('swap', !allEnabled)
      currencyProvider.refresh();
      swapProvider.refresh()
      void updateContextKeys()
    })
  )
  context.subscriptions.push(
    vscode.commands.registerCommand('edge.enableAllCurrency', async () => {
      await setSectionEnabledBatch('currency', true)
      currencyProvider.refresh(); swapProvider.refresh(); void updateContextKeys()
    })
  )
  context.subscriptions.push(
    vscode.commands.registerCommand('edge.disableAllCurrency', async () => {
      await setSectionEnabledBatch('currency', false)
      currencyProvider.refresh(); swapProvider.refresh(); void updateContextKeys()
    })
  )
  context.subscriptions.push(
    vscode.commands.registerCommand('edge.enableAllSwap', async () => {
      await setSectionEnabledBatch('swap', true)
      currencyProvider.refresh(); swapProvider.refresh(); void updateContextKeys()
    })
  )
  context.subscriptions.push(
    vscode.commands.registerCommand('edge.disableAllSwap', async () => {
      await setSectionEnabledBatch('swap', false)
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
  // Sort and favorites
  context.subscriptions.push(
    vscode.commands.registerCommand('edge.sortCurrencyAZ', () => currencyProvider.toggleSort())
  )
  context.subscriptions.push(
    vscode.commands.registerCommand('edge.sortSwapAZ', () => swapProvider.toggleSort())
  )
  context.subscriptions.push(
    vscode.commands.registerCommand('edge.toggleFavorite', (item?: PluginItem) => {
      if (item == null || item.kind !== 'plugin') return
      const favKey = `${item.entry.section}:${item.entry.key}`
      if (item.entry.section === 'currency') currencyProvider.toggleFavorite(favKey)
      else swapProvider.toggleFavorite(favKey)
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
  private sortAZ = false
  constructor(private readonly onlySection?: Section) {}
  private readonly emitter = new vscode.EventEmitter<void>()
  readonly onDidChangeTreeData = this.emitter.event

  setFilter(text: string | undefined): void {
    this.filterText = text?.toLowerCase().trim() || undefined
    this.refresh()
  }

  toggleSort(): void { this.sortAZ = !this.sortAZ; this.refresh() }
  toggleFavorite(key: string): void { this.favorites.has(key) ? this.favorites.delete(key) : this.favorites.add(key); this.refresh() }

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
    const workspaceFolder = vscode.workspace.workspaceFolders != null ? vscode.workspace.workspaceFolders[0] : undefined
    if (workspaceFolder == null) return []
    const relativePath = vscode.workspace.getConfiguration('edge.corePlugins').get<string>('relativePath') ?? 'src/util/corePlugins.ts'
    const fileUri = vscode.Uri.joinPath(workspaceFolder.uri, relativePath)
    const openDoc = vscode.workspace.textDocuments.find(d => d.uri.toString() === fileUri.toString())
    if (openDoc != null) return extractPluginLines(openDoc.getText())
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
    return [
      'DEBUG_PLUGINS',
      'DEBUG_CORE',
      'DEBUG_CURRENCY_PLUGINS',
      'DEBUG_ACCOUNTBASED',
      'DEBUG_EXCHANGES',
      'DEBUG_LOGBOX',
      'USE_FAKE_CORE'
    ].map(key => ({ key, value: env[key] === true }))
  }

  refresh(): void {
    this.emitter.fire()
  }
}

async function readPluginsOrShowError(): Promise<{ doc: vscode.TextDocument | undefined; entries: PluginLine[] }> {
  const workspaceFolder = vscode.workspace.workspaceFolders != null ? vscode.workspace.workspaceFolders[0] : undefined
  if (workspaceFolder == null) {
    vscode.window.showErrorMessage('Open the edge-react-gui workspace first.')
    return { doc: undefined, entries: [] }
  }
  const relativePath = vscode.workspace.getConfiguration('edge.corePlugins').get<string>('relativePath') ?? 'src/util/corePlugins.ts'
  const fileUri = vscode.Uri.joinPath(workspaceFolder.uri, relativePath)
  let doc: vscode.TextDocument
  try {
    doc = await vscode.workspace.openTextDocument(fileUri)
  } catch {
    vscode.window.showErrorMessage(`File not found: ${relativePath}`)
    return { doc: undefined, entries: [] }
  }
  const text = doc.getText()
  const entries = extractPluginLines(text)
  if (entries.length === 0) {
    vscode.window.showErrorMessage('No plugin entries found in currencyPlugins/swapPlugins.')
  }
  return { doc, entries }
}

async function togglePluginLine(target: PluginLine): Promise<void> {
  const { doc, entries } = await readPluginsOrShowError()
  if (doc == null || entries.length === 0) return
  // Re-find the entry by key+section in case offsets shifted
  const entry = entries.find(e => e.key === target.key && e.section === target.section)
  if (entry == null) return
  const edit = new vscode.WorkspaceEdit()
  const range = new vscode.Range(doc.positionAt(entry.lineStart), doc.positionAt(entry.lineEnd))
  const originalLine = doc.getText(range)
  const updatedLine = toggleComment(originalLine)
  edit.replace(doc.uri, range, updatedLine)
  await vscode.workspace.applyEdit(edit)
  await doc.save()
  await fixCommasForSection(entry.section)
}

async function setPluginEnabled(target: PluginLine, enable: boolean): Promise<void> {
  const { doc, entries } = await readPluginsOrShowError()
  if (doc == null || entries.length === 0) return
  const entry = entries.find(e => e.key === target.key && e.section === target.section)
  if (entry == null) return
  if (entry.enabled === enable) return
  const range = new vscode.Range(doc.positionAt(entry.lineStart), doc.positionAt(entry.lineEnd))
  const originalLine = doc.getText(range)
  const updatedLine = toggleComment(originalLine)
  const edit = new vscode.WorkspaceEdit()
  edit.replace(doc.uri, range, updatedLine)
  await vscode.workspace.applyEdit(edit)
  await doc.save()
  await fixCommasForSection(entry.section)
}

async function setSectionEnabled(section: Section, enable: boolean): Promise<void> {
  const { doc, entries } = await readPluginsOrShowError()
  if (doc == null || entries.length === 0) return
  const sectionEntries = entries.filter(e => e.section === section)
  for (const e of sectionEntries) {
    if (e.enabled !== enable) {
      await setPluginEnabled(e, enable)
    }
  }
  await fixCommasForSection(section)
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
      if (m != null) {
        const rawKey = m[3]
        const key = rawKey.replace(/^[\'\"]|[\'\"]$/g, '')
        const enabled = m[2] == null
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
  const workspaceFolder = vscode.workspace.workspaceFolders != null ? vscode.workspace.workspaceFolders[0] : undefined
  if (workspaceFolder == null) return {}
  const envUri = vscode.Uri.joinPath(workspaceFolder.uri, 'env.json')
  try {
    const doc = await vscode.workspace.openTextDocument(envUri)
    const json = JSON.parse(doc.getText()) as EnvJson
    const out: Record<string, boolean> = {}
    for (const [k, v] of Object.entries(json)) {
      if (typeof v === 'boolean') out[k] = v
    }
    return out
  } catch {
    return {}
  }
}

async function toggleEnvBoolean(key: string): Promise<void> {
  const workspaceFolder = vscode.workspace.workspaceFolders != null ? vscode.workspace.workspaceFolders[0] : undefined
  if (workspaceFolder == null) return
  const envUri = vscode.Uri.joinPath(workspaceFolder.uri, 'env.json')
  let doc: vscode.TextDocument
  try {
    doc = await vscode.workspace.openTextDocument(envUri)
  } catch {
    return
  }
  const text = doc.getText()
  const regex = new RegExp(`(\\"${key}\\"\\s*:\\s*)(true|false)`, 'g')
  const newText = text.replace(regex, (_m, p1, p2) => `${p1}${p2 === 'true' ? 'false' : 'true'}`)
  if (newText === text) return
  const edit = new vscode.WorkspaceEdit()
  edit.replace(envUri, new vscode.Range(doc.positionAt(0), doc.positionAt(text.length)), newText)
  await vscode.workspace.applyEdit(edit)
  await doc.save()
}
