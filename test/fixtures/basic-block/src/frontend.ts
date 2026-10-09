import { select } from '@wordpress/data';
import { shared } from './blocks/basic/shared.js';

export const frontend = () => select('core').getEntityRecords('postType', 'post') && shared();
