import { publicApiUrl } from '../../lib/api';
import type { Attachment } from './types';

/** URL d'affichage d'une image jointe (lien de capacité). */
export const attachmentSrc = (a: Attachment) => publicApiUrl(`/attachments/${a.id}`);
