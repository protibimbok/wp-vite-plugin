import { wpVite } from '../../../src/index.ts';

export default { plugins: [wpVite({ entries: { 'admin/index': 'src/admin.ts' } })] };
