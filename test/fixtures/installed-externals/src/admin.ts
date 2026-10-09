export const admin = async () => (await import('@wordpress/a11y')).speak('ready');

document.addEventListener('DOMContentLoaded', () => void admin());
