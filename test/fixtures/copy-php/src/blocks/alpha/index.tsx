import { registerBlockType } from '@wordpress/blocks';
registerBlockType('fixture/alpha', { edit: () => <p>alpha</p>, save: () => null });
