// Accounts + cloud sync (Firebase). These values are public by design — they only identify the project.
// Who can read what is enforced by the Firestore security rules (see firestore.rules).
// While they are empty the app runs fully offline, without accounts.
export const CLOUD = {
  apiKey: '',      // Firebase → Project settings → General → Web API key
  projectId: '',   // Firebase → Project settings → General → Project ID
};

export const cloudConfigured = () => !!(CLOUD.apiKey && CLOUD.projectId);
