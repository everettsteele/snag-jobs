const { google } = require('googleapis');
const { getAuthedClient } = require('./auth');
const { query } = require('../../db/pool');

const ROOT_FOLDER_NAME = 'Snag - Job Applications';
const BASE_RESUMES_FOLDER_NAME = 'Base Resumes';

async function getDrive(userId) {
  const auth = await getAuthedClient(userId);
  if (!auth) throw new Error('Google Drive not connected. Connect your Google account in Settings.');
  return google.drive({ version: 'v3', auth });
}

// Find or create a folder by name under a parent
async function findOrCreateFolder(drive, name, parentId) {
  const q = parentId
    ? `name='${name}' and mimeType='application/vnd.google-apps.folder' and '${parentId}' in parents and trashed=false`
    : `name='${name}' and mimeType='application/vnd.google-apps.folder' and trashed=false`;

  const { data } = await drive.files.list({ q, fields: 'files(id,name)', pageSize: 1 });
  if (data.files.length > 0) return data.files[0].id;

  const fileMetadata = {
    name,
    mimeType: 'application/vnd.google-apps.folder',
    ...(parentId ? { parents: [parentId] } : {}),
  };
  const { data: folder } = await drive.files.create({ resource: fileMetadata, fields: 'id' });
  return folder.id;
}

// Ensure user has root folder structure, cache IDs in profile
async function ensureRootFolders(userId) {
  const { rows } = await query(
    'SELECT drive_root_folder_id, drive_base_resumes_folder_id FROM user_profiles WHERE user_id = $1',
    [userId]
  );
  const profile = rows[0] || {};

  const drive = await getDrive(userId);

  let rootId = profile.drive_root_folder_id;
  if (!rootId) {
    rootId = await findOrCreateFolder(drive, ROOT_FOLDER_NAME, null);
    await query('UPDATE user_profiles SET drive_root_folder_id = $1 WHERE user_id = $2', [rootId, userId]);
  }

  let baseFolderId = profile.drive_base_resumes_folder_id;
  if (!baseFolderId) {
    baseFolderId = await findOrCreateFolder(drive, BASE_RESUMES_FOLDER_NAME, rootId);
    await query('UPDATE user_profiles SET drive_base_resumes_folder_id = $1 WHERE user_id = $2', [baseFolderId, userId]);
  }

  return { rootId, baseFolderId };
}

// Create a job application folder with cover letter doc and resume copy
async function createApplicationPackage(userId, { company, role, variant, coverLetterText, userName, userContact }) {
  const drive = await getDrive(userId);
  const { rootId, baseFolderId } = await ensureRootFolders(userId);

  // Create job-specific folder
  const folderName = `${company} - ${role}`;
  const folderId = await findOrCreateFolder(drive, folderName, rootId);

  // Copy resume variant if it exists
  if (variant && baseFolderId) {
    const variantFolderId = await findOrCreateFolder(drive, variant.charAt(0).toUpperCase() + variant.slice(1), baseFolderId);
    // Find resume PDF in variant folder
    const { data: resumes } = await drive.files.list({
      q: `'${variantFolderId}' in parents and mimeType='application/pdf' and trashed=false`,
      fields: 'files(id,name)',
      pageSize: 1,
    });
    if (resumes.files.length > 0) {
      await drive.files.copy({
        fileId: resumes.files[0].id,
        resource: { name: resumes.files[0].name, parents: [folderId] },
      });
    }
  }

  // Create cover letter as Google Doc
  if (coverLetterText) {
    const docMetadata = {
      name: `${company} - Cover Letter`,
      mimeType: 'application/vnd.google-apps.document',
      parents: [folderId],
    };
    const { data: doc } = await drive.files.create({ resource: docMetadata, fields: 'id' });

    // Write content using Docs API
    const docs = google.docs({ version: 'v1', auth: await getAuthedClient(userId) });
    const requests = [];
    let insertIdx = 1;

    // Header
    if (userName) {
      requests.push({ insertText: { location: { index: insertIdx }, text: userName.toUpperCase() + '\n' } });
      insertIdx += userName.length + 1;
    }
    if (userContact) {
      requests.push({ insertText: { location: { index: insertIdx }, text: userContact + '\n\n' } });
      insertIdx += userContact.length + 2;
    }

    // Date
    const dateStr = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    requests.push({ insertText: { location: { index: insertIdx }, text: dateStr + '\n' } });
    insertIdx += dateStr.length + 1;

    // Company
    requests.push({ insertText: { location: { index: insertIdx }, text: company + '\n\n' } });
    insertIdx += company.length + 2;

    // Body paragraphs
    const paragraphs = coverLetterText.split(/\n{2,}/).filter(p => p.trim());
    paragraphs.forEach((p, i) => {
      const text = p.trim() + (i < paragraphs.length - 1 ? '\n\n' : '\n');
      requests.push({ insertText: { location: { index: insertIdx }, text } });
      insertIdx += text.length;
    });

    if (requests.length > 0) {
      await docs.documents.batchUpdate({ documentId: doc.id, requestBody: { requests } });
    }
  }

  // Get folder URL
  const folderUrl = `https://drive.google.com/drive/folders/${folderId}`;
  return { folderId, folderUrl };
}

// List files in user's root folder
async function listApplicationFolders(userId) {
  const drive = await getDrive(userId);
  const { rootId } = await ensureRootFolders(userId);
  const { data } = await drive.files.list({
    q: `'${rootId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
    fields: 'files(id,name,createdTime)',
    orderBy: 'createdTime desc',
    pageSize: 100,
  });
  return data.files;
}

module.exports = { createApplicationPackage, ensureRootFolders, listApplicationFolders };
