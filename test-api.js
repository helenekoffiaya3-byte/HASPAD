// test-api.js
const { testApiConnection } = require('./services/resellerspanel.service');

async function runTest() {
  console.log('🔄 Test de connexion à ResellersPanel en cours...');
  try {
    const result = await testApiConnection();
    console.log('Détails du compte :', result);
  } catch (error) {
    console.log('Le test a échoué. Vérifiez vos identifiants dans le fichier .env');
  }
}

runTest();
