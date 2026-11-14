import { create } from 'zustand';
interface UiState {
  libraryId: string | null; collectionId: string | null;
  editor: 'library' | 'collection' | 'entry' | null;
  editingId: string | null; text: string;
  select: (libraryId: string, collectionId?: string) => void;
  openEditor: (editor: UiState['editor'], text?: string, id?: string) => void;
  setText: (text: string) => void;
}
export const useUi = create<UiState>(set => ({
  libraryId: null, collectionId: null, editor: null, editingId: null, text: '',
  select: (libraryId, collectionId) => set({ libraryId, collectionId: collectionId ?? null }),
  openEditor: (editor, text = '', id) => set({ editor, text, editingId: id ?? null }),
  setText: text => set({ text }),
}));
