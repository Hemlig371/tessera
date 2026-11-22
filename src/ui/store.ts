import { create } from 'zustand';
interface UiState {
  screen: 'libraries' | 'library' | 'summary' | 'records';
  libraryId: string | null;
  collectionId: string | null;
  profileId: string | null;
  editor: 'settings' | 'mail-sync' | 'large-attachments' | 'diagnostics' | 'file-settings' | 'trash' | 'history' | 'history-clear' | 'appearance' | 'library-start' | 'library-summary' | 'library' | 'collection' | 'entry' | 'quick-entry' | 'quick' | 'move' | 'fields' | 'form' | 'card' | 'list' | 'csv' | 'profiles' | 'presets' | null;
  editingId: string | null;
  text: string;
  search: string;
  scope: 'collection' | 'library' | 'all';
  navOpen: boolean;
  constructorOpen: boolean;
  searchOrigin: Pick<UiState, 'screen' | 'libraryId' | 'collectionId' | 'profileId' | 'scope' | 'search'> | null;
  select: (libraryId: string, collectionId?: string, profileId?: string) => void;
  selectSummary: (libraryId: string) => void;
  home: () => void;
  globalSearch: () => void;
  leaveSearch: () => void;
  openEditor: (editor: UiState['editor'], text?: string, id?: string) => void;
  setText: (text: string) => void;
  searchFor: (search: string, scope?: UiState['scope']) => void;
  toggleNav: () => void;
}
export const useUi = create<UiState>((set) => ({
  screen: 'libraries',
  libraryId: null,
  collectionId: null,
  profileId: null,
  editor: null,
  editingId: null,
  text: '',
  search: '',
  scope: 'collection',
  navOpen: false,
  constructorOpen: false,
  searchOrigin: null,
  home: () => set({ screen: 'libraries', libraryId: null, collectionId: null, profileId: null, scope: 'collection', search: '', navOpen: false, constructorOpen: false, searchOrigin: null }),
  globalSearch: () => set(old => ({
    searchOrigin: old.searchOrigin ?? { screen: old.screen, libraryId: old.libraryId, collectionId: old.collectionId, profileId: old.profileId, scope: old.scope, search: old.search },
    screen: 'records', scope: 'all', search: '', navOpen: false,
  })),
  leaveSearch: () => set(old => ({ ...(old.searchOrigin ?? { screen: 'libraries', libraryId: null, collectionId: null, profileId: null, scope: 'collection', search: '' }), searchOrigin: null, navOpen: false })),
  select: (libraryId, collectionId, profileId) =>
    set({
      screen: collectionId ? 'records' : 'library',
      libraryId,
      collectionId: collectionId ?? null,
      profileId: profileId ?? null,
      scope: 'collection',
      search: '',
      searchOrigin: null,
      ...(collectionId ? { navOpen: false } : {}),
    }),
  selectSummary: (libraryId) => set({ screen: 'summary', libraryId, collectionId: null, profileId: null, scope: 'collection', search: '', searchOrigin: null, navOpen: false }),
  openEditor: (editor, text = '', id) => set({ editor, text, editingId: id ?? null }),
  setText: (text) => set({ text }),
  searchFor: (search, scope) => set({ search, ...(scope ? { scope, screen: 'records' } : {}) }),
  toggleNav: () => set((old) => ({ navOpen: !old.navOpen })),
}));
