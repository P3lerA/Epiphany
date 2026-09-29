// Types for the page's classic scripts (theme, renderer, motion, piles, preview, settings): they share one global scope, which
// jsconfig.json makes the editor see as one program. main.js and preload.js are CommonJS modules and stay out of it.
// The page's side of the IPC is written by hand: keep Api in step with preload.js (CALLS, EVENTS) and the main.js HANDLERS.

/** A picture, as main.js enrich() hands it over. */
interface Item {
  file: string; src: string; page: string; time: string; project: string
  url: string; thumb: string // file: URLs; thumb falls back to url
  site: string; ai: boolean
  rating: 'g' | 's' | 'q' | 'e' | '' // '' = no booru match yet
  artist?: string; character?: string; copyright?: string; tags?: string // comma-joined, underscores kept (artist: 'a, @b')
  tagged: 'booru' | 'unsure' | 'tagger' | 'none' // tagger: no booru has it, the tagger guessed
  candidates?: { score: number; url: string; head: string; tags: string; post?: string; plus: string[] }[] // close matches waiting for a pick
  from?: { site: string; url?: string } // the booru post the tags came from
  replace?: true // onSaved: same picture, fresher facts
}

interface Profile { caption: string; qualities: string; scores: string; spaces: boolean }

interface Settings {
  project: string; quote: string; lookup: boolean; sites: string[]; accept: number; autotag: boolean; safe?: boolean; debug?: boolean
  profile: string; overrides: Partial<Record<keyof Profile, string | boolean>>
}

interface Api {
  list(): Promise<Item[]>
  projects(): Promise<string[]>
  newProject(name: string): Promise<void>
  getSettings(): Promise<Settings>
  setSettings(s: Settings): Promise<void>
  profiles(): Promise<Record<string, Profile>>
  getCaption(item: Item): Promise<{ head: string; tags: string }> // head: the profile's part, from the sidecar; tags: the .txt
  setCaption(item: Item, text: string): Promise<void> // the .txt only; a rebuild from the sidecar replaces it
  setField(items: Item[], field: 'copyright' | 'character' | 'artist', text: string): Promise<void> // comma-separated names, over the booru's or the tagger's
  open(url: string): Promise<void>
  editTemplate(): Promise<string>
  templateInfo(): Promise<{ text: string; custom: boolean }>
  resetTemplate(): Promise<void>
  lookup(item: Item): Promise<unknown>
  lookupAll(items: Item[]): Promise<void>
  pick(item: Item, candidate: number): Promise<void>
  projectMenu(name: string): Promise<void>
  searchSites(): Promise<string[]>
  search(site: string, q: string): Promise<Item[]>
  tagMenu(tag: string): Promise<void>
  menu(items: Item[]): Promise<void> // right-click: the selection the picture is in, or just it
  quoteSources(): Promise<string[]>
  quote(): Promise<string | null>
  getCreds(): Promise<Record<string, Record<string, string>>>
  setCred(site: string, key: string, value: string): Promise<void>
  oauth(site: string): Promise<void>
  checkUpdate(): Promise<{ current: string; latest: string | null; how: 'portable' | 'installed' | 'dev' }>
  update(): Promise<void>
  instruments(): Promise<Record<string, { status: string; action: string }>>
  exportExtension(): Promise<void>
  installGdl(): Promise<string>
  export(items: Item[]): Promise<void>
  tagWiki(tag: string): Promise<string | null> // null: no wiki, or not reachable now
  safe(): Promise<boolean> // launched with -safe: safe mode on, whatever Settings say
  tag(items: Item[]): Promise<void>
  installTagger(): Promise<void>
  removeTagger(): Promise<void>
  devtools(): Promise<void>
  restart(): Promise<void>
  theme(theme: 'system' | 'light' | 'dark', bar: { color: string; symbolColor: string; height: number }): void
  onSaved(cb: (item: Item) => void): void
  onRemoved(cb: (file: string) => void): void
  onProjectRemoved(cb: (name: string) => void): void
  onTasks(cb: (running: string[]) => void): void // every task's current line, oldest first
  onNote(cb: (note: { text: string; error: boolean }) => void): void
  onSearch(cb: (tag: string) => void): void
  onOpenProject(cb: (name: string) => void): void
  onEdit(cb: (e: { items: Item[]; field: 'copyright' | 'character' | 'artist'; label: string }) => void): void // right-click > Edit
}
declare const api: Api

interface HTMLImageElement { item: Item } // grid pictures carry their item (renderer.js decorate)

/** Where something sits (motion.js pose): its layout box, and for a print the pose its pile gives it. */
interface Pose { el: HTMLElement; box: DOMRect; translate: string; rotate: string; frame?: boolean }

/** A swap in the air (piles.js swap): what it animates, the ghosts it left, and the change, to take it back (motion.js rewind). */
interface Flight {
  anims: Animation[]; ghosts: HTMLElement[]
  key?: 'piles' // only the piles toggle can be taken back
  dir: 1 | -1; change: () => void; root: HTMLElement; top: number
  gen?: number // settle's generation: a rewind re-settles, the older wait must not land it
}
