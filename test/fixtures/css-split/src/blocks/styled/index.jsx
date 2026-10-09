import { registerBlockType } from '@wordpress/blocks';
import classes from './editor.module.css';
import './style.scss';
import './editor.scss';

registerBlockType('fixture/styled', {
  edit: () => <div className={classes.panel}>Styled</div>,
  save: () => null,
});
