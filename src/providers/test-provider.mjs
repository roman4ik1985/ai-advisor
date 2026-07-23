export async function askViaTest(config) {
  await new Promise((resolve) => setTimeout(resolve, config.testProviderDelayMs));
  return 'Test-only AI response.';
}
