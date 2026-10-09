import { useState } from '@wordpress/element';
import apiFetch from '@wordpress/api-fetch';
import { shared } from './blocks/basic/shared.js';

export const admin = async () => {
  const { speak } = await import('@wordpress/a11y');
  const [count] = useState(0);
  speak(shared() + count);
  return apiFetch({ path: '/wp/v2/posts' });
};

document.addEventListener('DOMContentLoaded', () => void admin());
