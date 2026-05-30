import { Decoration, DecorationSet, EditorView } from '@codemirror/view';
import { StateEffect, StateField } from '@codemirror/state';

export interface SearchMatch {
  from: number;
  to: number;
}

export const searchMatchesEffect = StateEffect.define<{
  matches: SearchMatch[];
  activeIndex: number;
}>();

export const searchHighlightField = StateField.define<DecorationSet>({
  create() {
    return Decoration.none;
  },
  update(decorations, tr) {
    decorations = decorations.map(tr.changes);
    for (const e of tr.effects) {
      if (e.is(searchMatchesEffect)) {
        const { matches, activeIndex } = e.value;
        decorations = Decoration.set(
          matches.map((m, i) =>
            Decoration.mark({
              class: i === activeIndex ? 'search-match-active' : 'search-match',
            }).range(m.from, m.to)
          )
        );
      }
    }
    return decorations;
  },
  provide: (f) => EditorView.decorations.from(f),
});

export const searchTheme = EditorView.theme({
  '.search-match': {
    backgroundColor: 'rgba(251, 191, 36, 0.3)',
    borderRadius: '2px',
  },
  '.search-match-active': {
    backgroundColor: 'rgba(245, 158, 11, 0.6)',
    borderRadius: '2px',
  },
});
