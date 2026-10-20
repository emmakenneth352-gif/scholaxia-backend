import 'dart:io';
import 'dart:convert';

// Simple test to verify CBT API endpoints
// Run with: dart test_cbt_api.dart

void main() async {
  print('=== CBT API Test ===\n');
  
  // Test configuration - update these with your actual API details
  const String baseUrl = 'YOUR_API_BASE_URL'; // e.g., 'https://api.scholaxia.com'
  const String authToken = 'YOUR_AUTH_TOKEN'; // Get from your login/session
  
  if (baseUrl == 'YOUR_API_BASE_URL' || authToken == 'YOUR_AUTH_TOKEN') {
    print('ERROR: Please update baseUrl and authToken in this file');
    print('You can get the authToken from your browser localStorage or app session');
    return;
  }
  
  // Test 1: CBT Exams For Me
  print('Test 1: GET /api/v1/cbt/exams/for-me');
  await testApiCall(
    '$baseUrl/api/v1/cbt/exams/for-me?paper_kind=cbt_practice',
    authToken,
  );
  
  // Test 2: CBT Package Access
  print('\nTest 2: GET /api/v1/payments/paystack/cbt-access');
  await testApiCall(
    '$baseUrl/api/v1/payments/paystack/cbt-access',
    authToken,
  );
  
  // Test 3: CBT Coupon Access
  print('\nTest 3: GET /api/v1/cbt/coupons/access');
  await testApiCall(
    '$baseUrl/api/v1/cbt/coupons/access',
    authToken,
  );
  
  print('\n=== CBT API Test Complete ===');
}

Future<void> testApiCall(String url, String token) async {
  try {
    final request = await HttpClient().getUrl(Uri.parse(url));
    request.headers.add('Authorization', 'Bearer $token');
    request.headers.add('Content-Type', 'application/json');
    
    final response = await request.close();
    final responseBody = await response.transform(utf8.decoder).join();
    
    print('Status: ${response.statusCode}');
    
    if (response.statusCode == 200) {
      final data = jsonDecode(responseBody);
      print('Response: ${JsonEncoder.withIndent('  ').convert(data)}');
    } else {
      print('Error Response: $responseBody');
    }
  } catch (e) {
    print('Exception: $e');
  }
}