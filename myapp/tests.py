from django.test import TestCase, Client
from django.contrib.auth.models import User
from .models import UserProfile
import json

class RoleAuthenticationTests(TestCase):
    def setUp(self):
        self.client = Client()
        
        # Create Admin User
        self.admin = User.objects.create_user(username='admin', email='admin@test.com', password='adminpass')
        self.admin_profile = self.admin.profile
        self.admin_profile.role = 'Admin'
        self.admin_profile.save()
        
        # Create Designer User
        self.designer = User.objects.create_user(username='designer', email='designer@test.com', password='designerpass')
        self.designer_profile = self.designer.profile
        self.designer_profile.role = 'Designer'
        self.designer_profile.save()
        
        # Create Production User
        self.production = User.objects.create_user(username='production', email='production@test.com', password='prodpass')
        self.production_profile = self.production.profile
        self.production_profile.role = 'Production'
        self.production_profile.save()

    def test_unauthenticated_access_redirects(self):
        response = self.client.get('/admin.html')
        self.assertRedirects(response, '/')
        response = self.client.get('/designer.html')
        self.assertRedirects(response, '/')
        response = self.client.get('/production.html')
        self.assertRedirects(response, '/')

    def test_login_admin(self):
        response = self.client.post('/', {'login_id': 'admin@test.com', 'password': 'adminpass'})
        self.assertRedirects(response, '/admin.html')

    def test_login_designer(self):
        response = self.client.post('/', {'login_id': 'designer', 'password': 'designerpass'})
        self.assertRedirects(response, '/designer.html')

    def test_login_production(self):
        response = self.client.post('/', {'login_id': 'production', 'password': 'prodpass'})
        self.assertRedirects(response, '/production.html')

    def test_admin_pages_access(self):
        self.client.login(username='admin', password='adminpass')
        response = self.client.get('/admin.html')
        self.assertEqual(response.status_code, 200)
        self.assertTemplateUsed(response, 'admin_dashboard/admin.html')
        
        subpages = ['orders.html', 'users.html', 'inventory.html', 'products.html', 'masters.html', 'financials.html', 'production.html']
        for page in subpages:
            res = self.client.get(f'/admin_dashboard/{page}')
            self.assertEqual(res.status_code, 200)
            self.assertTemplateUsed(res, f'admin_dashboard/{page}')

    def test_designer_pages_access(self):
        self.client.login(username='designer', password='designerpass')
        subpages = ['designer.html', 'queue.html', 'canvas.html', 'history.html', 'charts.html']
        for page in subpages:
            res = self.client.get(f'/designer_dashboard/{page}')
            self.assertEqual(res.status_code, 200)
            self.assertTemplateUsed(res, f'designer_dashboard/{page}')

    def test_production_pages_access(self):
        self.client.login(username='production', password='prodpass')
        subpages = ['production.html', 'kanban.html', 'verification.html', 'qc.html', 'charts.html']
        for page in subpages:
            res = self.client.get(f'/production_dashboard/{page}')
            self.assertEqual(res.status_code, 200)
            self.assertTemplateUsed(res, f'production_dashboard/{page}')

    def test_superadmin_user_creation_api(self):
        self.client.login(username='admin', password='adminpass')
        payload = {
            'name': 'New Designer',
            'email': 'newdesigner@vishwasports.com',
            'password': 'secretpassword123',
            'role': 'Designer',
            'status': 'Active'
        }
        res = self.client.post('/api/users/save/', data=json.dumps(payload), content_type='application/json')
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertTrue(data.get('success'))
        
        self.client.logout()
        login_res = self.client.post('/', {'login_id': 'newdesigner@vishwasports.com', 'password': 'secretpassword123'})
        self.assertRedirects(login_res, '/designer.html')

class UserLoginAPITests(TestCase):
    def setUp(self):
        self.client = Client()
        self.user = User.objects.create_user(
            username='testuser',
            email='testuser@vishwasports.com',
            password='testpassword123',
            first_name='Test User'
        )
        self.profile, _ = UserProfile.objects.get_or_create(user=self.user)
        self.profile.role = 'Designer'
        self.profile.status = 'Active'
        self.profile.save()

    def test_api_login_success(self):
        payload = {'login_id': 'testuser@vishwasports.com', 'password': 'testpassword123'}
        response = self.client.post('/api/auth/login/', data=json.dumps(payload), content_type='application/json')
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertTrue(data.get('success'))
        self.assertEqual(data.get('redirect_url'), '/designer.html')
        self.assertEqual(data['user']['email'], 'testuser@vishwasports.com')

    def test_api_login_invalid_password(self):
        payload = {'login_id': 'testuser@vishwasports.com', 'password': 'wrongpassword'}
        response = self.client.post('/api/auth/login/', data=json.dumps(payload), content_type='application/json')
        self.assertEqual(response.status_code, 401)
        data = response.json()
        self.assertFalse(data.get('success'))

    def test_api_current_user_authenticated(self):
        self.client.login(username='testuser', password='testpassword123')
        response = self.client.get('/api/auth/me/')
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertTrue(data.get('success'))
        self.assertEqual(data['user']['role'], 'Designer')

    def test_api_current_user_unauthenticated(self):
        response = self.client.get('/api/auth/me/')
        self.assertEqual(response.status_code, 401)

    def test_api_logout(self):
        self.client.login(username='testuser', password='testpassword123')
        response = self.client.post('/api/auth/logout/')
        self.assertEqual(response.status_code, 200)
        res_me = self.client.get('/api/auth/me/')
        self.assertEqual(res_me.status_code, 401)

    def test_end_user_web_login_denied(self):
        user_client = User.objects.create_user(
            username='enduser',
            email='client@example.com',
            password='clientpass123',
            first_name='App Client'
        )
        profile, _ = UserProfile.objects.get_or_create(user=user_client)
        profile.role = 'User'
        profile.status = 'Active'
        profile.save()

        # Attempt web portal login via API with portal: 'web'
        payload_web = {'login_id': 'client@example.com', 'password': 'clientpass123', 'portal': 'web'}
        res_web = self.client.post('/api/auth/login/', data=json.dumps(payload_web), content_type='application/json')
        self.assertEqual(res_web.status_code, 403)
        self.assertFalse(res_web.json().get('success'))
        self.assertIn('End-user accounts do not have a web dashboard', res_web.json().get('error'))

        # Attempt standard app API login without portal: 'web' (representing mobile app client)
        payload_app = {'login_id': 'client@example.com', 'password': 'clientpass123', 'portal': 'app'}
        res_app = self.client.post('/api/auth/login/', data=json.dumps(payload_app), content_type='application/json')
        self.assertEqual(res_app.status_code, 200)
        data = res_app.json()
        self.assertTrue(data.get('success'))
        self.assertEqual(data['user']['role'], 'User')

class OTPAuthenticationAPITests(TestCase):
    def test_registration_and_login_otp_workflow(self):
        # 1. New phone number triggers Registration OTP
        phone = "+919876543210"
        res_send = self.client.post('/api/auth/send-otp/', data={'phone': phone})
        self.assertEqual(res_send.status_code, 200)
        data_send = res_send.json()
        self.assertTrue(data_send['success'])
        self.assertEqual(data_send['action'], 'register')
        self.assertEqual(data_send['expiry_minutes'], 5)
        dev_otp = data_send['dev_otp']
        self.assertEqual(len(dev_otp), 6)

        # Verify that trying to call login verify-otp on an unregistered account fails
        res_fail_ver = self.client.post('/api/auth/verify-otp/', data={'phone': phone, 'otp': dev_otp})
        self.assertEqual(res_fail_ver.status_code, 404)
        self.assertFalse(res_fail_ver.json()['success'])

        # 2. Verify Registration OTP creates user with User role via dedicated /api/auth/register/ endpoint
        res_ver = self.client.post('/api/auth/register/', data={
            'phone': phone,
            'otp': dev_otp,
            'name': 'Rahul Verma',
            'email': 'rahul@example.com'
        })
        self.assertEqual(res_ver.status_code, 200)
        data_ver = res_ver.json()
        self.assertTrue(data_ver['success'])
        self.assertEqual(data_ver['action'], 'register')
        self.assertEqual(data_ver['user']['role'], 'User')
        self.assertEqual(data_ver['user']['phone'], phone)

        # Verify that calling register again on an already registered account fails
        res_fail_reg = self.client.post('/api/auth/register/', data={'phone': phone, 'otp': '123456'})
        self.assertEqual(res_fail_reg.status_code, 400)
        self.assertFalse(res_fail_reg.json()['success'])

        # Confirm session is logged in via /api/auth/me/
        res_me = self.client.get('/api/auth/me/')
        self.assertEqual(res_me.status_code, 200)
        self.assertEqual(res_me.json()['user']['phone'], phone)

        # 3. Log out and send OTP again for same phone -> should now trigger Login OTP
        self.client.post('/api/auth/logout/')
        res_send2 = self.client.post('/api/auth/send-otp/', data={'phone': phone})
        self.assertEqual(res_send2.status_code, 200)
        self.assertEqual(res_send2.json()['action'], 'login')

        # 4. Test Dev Master OTP code '123456' on login
        res_ver2 = self.client.post('/api/auth/verify-otp/', data={'phone': phone, 'otp': '123456'})
        self.assertEqual(res_ver2.status_code, 200)
        self.assertEqual(res_ver2.json()['action'], 'login')
        self.assertEqual(res_ver2.json()['user']['role'], 'User')

    def test_invalid_otp_submission(self):
        # 1. Test invalid OTP on registration endpoint (new phone)
        res_bad_reg = self.client.post('/api/auth/register/', data={'phone': '+919999999999', 'otp': '000000'})
        self.assertEqual(res_bad_reg.status_code, 400)
        self.assertFalse(res_bad_reg.json()['success'])

        # 2. Register account first, then test invalid OTP on login verify-otp endpoint
        self.client.post('/api/auth/register/', data={'phone': '+919999999999', 'otp': '123456'})
        res_bad_login = self.client.post('/api/auth/verify-otp/', data={'phone': '+919999999999', 'otp': '000000'})
        self.assertEqual(res_bad_login.status_code, 400)
        self.assertFalse(res_bad_login.json()['success'])

    def test_query_params_and_smail_alias(self):
        # Test sending OTP via URL query parameter in POST request
        phone = "+918888888888"
        res_send = self.client.post(f'/api/auth/send-otp/?phone={phone}')
        self.assertEqual(res_send.status_code, 200)
        data_send = res_send.json()
        self.assertTrue(data_send['success'])
        self.assertEqual(data_send['action'], 'register')
        dev_otp = data_send['dev_otp']

        # Test verifying OTP with query parameters and 'smail' alias via register endpoint
        res_ver = self.client.post(f'/api/auth/register/?phone={phone}&otp={dev_otp}&name=Suresh&smail=suresh@example.com')
        self.assertEqual(res_ver.status_code, 200)
        data_ver = res_ver.json()
        self.assertTrue(data_ver['success'])
        self.assertEqual(data_ver['user']['email'], 'suresh@example.com')
        self.assertEqual(data_ver['user']['phone'], phone)


class BearerTokenAndCheckUserTests(TestCase):
    def test_bearer_token_and_existence_check(self):
        phone = "+917777777777"
        
        # 1. Check user existence before account creation
        res_before = self.client.get(f'/api/auth/check-user/?phone={phone}')
        self.assertEqual(res_before.status_code, 200)
        self.assertFalse(res_before.json()['exists'])
        self.assertEqual(res_before.json()['action'], 'register')

        # 2. Verify OTP with universal code via register to register account and retrieve Bearer token
        res_ver = self.client.post('/api/auth/register/', data={'phone': phone, 'otp': '123456', 'name': 'Token User'})
        self.assertEqual(res_ver.status_code, 200)
        data_ver = res_ver.json()
        self.assertTrue(data_ver['success'])
        token = data_ver.get('token')
        self.assertTrue(token)
        self.assertGreaterEqual(len(token), 32)

        # 3. Logout session cookies to simulate stateless mobile request
        self.client.logout()

        # 4. Test checking user existence via Authorization: Bearer <token>
        res_token_check = self.client.get('/api/auth/check-user/', HTTP_AUTHORIZATION=f'Bearer {token}')
        self.assertEqual(res_token_check.status_code, 200)
        data_check = res_token_check.json()
        self.assertTrue(data_check['exists'])
        self.assertTrue(data_check['valid'])
        self.assertEqual(data_check['user']['phone'], phone)

        # 5. Test accessing profile (/api/auth/me/) statelessly via Bearer Token
        res_me = self.client.get('/api/auth/me/', HTTP_AUTHORIZATION=f'Bearer {token}')
        self.assertEqual(res_me.status_code, 200)
        self.assertTrue(res_me.json()['success'])
        self.assertEqual(res_me.json()['user']['phone'], phone)

        # 6. Test check user existence by phone after registration
        res_after = self.client.get(f'/api/auth/check-user/?phone={phone}')
        self.assertEqual(res_after.status_code, 200)
        self.assertTrue(res_after.json()['exists'])
        self.assertEqual(res_after.json()['action'], 'login')

        # 7. Test invalid Bearer token
        res_bad_token = self.client.get('/api/auth/check-user/', HTTP_AUTHORIZATION='Bearer invalidtoken123')
        self.assertEqual(res_bad_token.status_code, 200)
        self.assertFalse(res_bad_token.json()['exists'])

    def test_explicit_bearer_token_generation(self):
        # 1. Test standard API registration
        res_reg = self.client.post('/api/auth/register/', data={
            'username': 'bearer_tester',
            'password': 'StrongPassword123!',
            'name': 'Bearer Tester',
            'email': 'bearer@tester.com',
            'phone': '+915555555555'
        })
        self.assertEqual(res_reg.status_code, 200)
        data_reg = res_reg.json()
        self.assertTrue(data_reg['success'])
        self.assertEqual(data_reg.get('token_type'), 'Bearer')
        bearer_token = data_reg.get('bearer_token')
        self.assertTrue(bearer_token)
        self.assertEqual(bearer_token, data_reg.get('token'))
        self.assertEqual(bearer_token, data_reg.get('access_token'))

        # 2. Test standard API login
        self.client.logout()
        res_login = self.client.post('/api/auth/login/', data={
            'username': 'bearer_tester',
            'password': 'StrongPassword123!'
        })
        self.assertEqual(res_login.status_code, 200)
        data_login = res_login.json()
        self.assertTrue(data_login['success'])
        self.assertEqual(data_login.get('token_type'), 'Bearer')
        self.assertTrue(data_login.get('bearer_token'))
        self.assertEqual(data_login.get('bearer_token'), data_login.get('token'))


class MasterListsAPITests(TestCase):
    def test_masters_api_with_bearer_token(self):
        # 1. Calling /api/masters/ without bearer token parameter should fail with 401
        res_no_auth = self.client.get('/api/masters/')
        self.assertEqual(res_no_auth.status_code, 401)
        self.assertFalse(res_no_auth.json()['success'])

        # 2. Create user and get Bearer Token
        res_reg = self.client.post('/api/auth/register/', data={
            'phone': '+916666666666',
            'otp': '123456',
            'name': 'Admin User',
            'role': 'Admin'
        })
        self.assertEqual(res_reg.status_code, 200)
        token = res_reg.json()['bearer_token']
        self.assertTrue(token)

        # 3. Call /api/masters/ passing bearer token as query parameter (?token=...)
        res_query = self.client.get(f'/api/masters/?token={token}')
        self.assertEqual(res_query.status_code, 200)
        data = res_query.json()
        self.assertTrue(data['success'])
        self.assertIn('jersey_types_master_list', data)
        self.assertIn('available_sizes_master_list', data)
        self.assertGreaterEqual(len(data['jersey_types_master_list']), 6)
        self.assertGreaterEqual(len(data['available_sizes_master_list']), 6)
        self.assertIn("V-Neck Jersey", data['jersey_types_master_list'])
        self.assertIn("XL", data['available_sizes_master_list'])

        # 4. Call /api/masters/ passing Authorization: Bearer <token> header
        res_header = self.client.get('/api/masters/', HTTP_AUTHORIZATION=f'Bearer {token}')
        self.assertEqual(res_header.status_code, 200)
        self.assertTrue(res_header.json()['success'])

