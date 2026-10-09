import { store, getContext } from '@wordpress/interactivity';

store('fixture/counter', {
  actions: {
    increment() {
      const context = getContext<{ count: number }>();
      context.count += 1;
    },
  },
});
