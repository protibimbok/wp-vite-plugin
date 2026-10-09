import { registerBlockType } from '@wordpress/blocks';
import { useBlockProps } from '@wordpress/block-editor';

registerBlockType('fixture/counter', {
  edit: () => <p {...useBlockProps()}>Counter</p>,
  save: () => null,
});
