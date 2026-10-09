import { registerBlockType } from '@wordpress/blocks';
import { __ } from '@wordpress/i18n';
import { shared } from './shared.js';

/* translators: block title */
const title = __('Basic block', 'fixture');

registerBlockType('fixture/basic', {
  title,
  edit: () => <p className="basic">{shared()}</p>,
  save: () => null,
});
