from django.shortcuts import render, redirect
from django.contrib.auth import authenticate, login, logout
from django.contrib.auth.models import User
from django.contrib import messages
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
from functools import wraps
import json
import random
import os
import requests
import uuid
from django.utils import timezone
from django.core.files.base import ContentFile
from django.conf import settings
from .models import UserProfile, OTPVerification, MasterJerseyType, MasterSize, ProductCatalog
# Role access decorator
def role_required(*allowed_roles):
    def decorator(view_func):
        @wraps(view_func)
        def _wrapped_view(request, *args, **kwargs):
            if not request.user.is_authenticated:
                return redirect('index')
            
            # Allow superusers or Admin role access to everything for admin oversight
            if request.user.is_superuser:
                return view_func(request, *args, **kwargs)
                
            profile = getattr(request.user, 'profile', None)
            if profile:
                if profile.status == 'Inactive':
                    logout(request)
                    messages.error(request, 'Your account has been deactivated.')
                    return redirect('index')
                
                # Admin has oversight access over all dashboards
                if profile.role == 'Admin' or profile.role in allowed_roles:
                    return view_func(request, *args, **kwargs)
                
            messages.error(request, 'You do not have permission to access that dashboard.')
            return redirect('index')
        return _wrapped_view
    return decorator
# Root index (Login View)
def index(request):
    if request.user.is_authenticated:
        role = 'Admin'
        if hasattr(request.user, 'profile'):
            role = request.user.profile.role
        elif not request.user.is_superuser:
            role = 'Designer'
            
        if role == 'Admin' or request.user.is_superuser:
            return redirect('admin')
        elif role == 'Designer':
            return redirect('designer')
        elif role == 'Production':
            return redirect('production')
        else:
            logout(request)
            messages.error(request, 'Access Denied: End-user accounts do not have a web dashboard. Please access your account via the mobile app using the API.')
            return render(request, 'index.html')
            
    if request.method == 'POST':
        login_id = request.POST.get('login_id', '').strip()
        password = request.POST.get('password', '')
        
        username = login_id
        user_obj = User.objects.filter(email__iexact=login_id).first()
        if user_obj:
            username = user_obj.username
        else:
            user_obj_by_name = User.objects.filter(username__iexact=login_id).first()
            if user_obj_by_name:
                username = user_obj_by_name.username
                
        user = authenticate(request, username=username, password=password)
        if user is not None:
            if hasattr(user, 'profile') and user.profile.status == 'Inactive':
                messages.error(request, 'Your account is inactive. Please contact the administrator.')
                return render(request, 'index.html')
                
            role = user.profile.role if hasattr(user, 'profile') else ('Admin' if user.is_superuser else 'Designer')
            if role not in ('Admin', 'Designer', 'Production') and not user.is_superuser:
                messages.error(request, 'Access Denied: End-user accounts do not have a web dashboard. Please access your account via the mobile app using the API.')
                return render(request, 'index.html')
                
            login(request, user)
            
            if role == 'Admin' or user.is_superuser:
                return redirect('admin')
            elif role == 'Designer':
                return redirect('designer')
            elif role == 'Production':
                return redirect('production')
            else:
                return redirect('admin')
        else:
            messages.error(request, 'Invalid username/email or password.')
            
    return render(request, 'index.html')
def root_redirect(request):
    return redirect('index')
def logout_view(request):
    logout(request)
    messages.success(request, 'You have been logged out.')
    return redirect('index')
# Dashboard Views
@role_required('Admin')
def admin_dashboard(request):
    return render(request, 'admin_dashboard/admin.html')
@role_required('Designer', 'Admin')
def designer_dashboard(request):
    products = ProductCatalog.objects.filter(status='Active')
    return render(request, 'designer_dashboard/designer.html', {'products': products})
@role_required('Production', 'Admin')
def prod_dashboard(request):
    return render(request, 'production_dashboard/production.html')
# Dedicated admin subpages
@role_required('Admin')
def admin_orders(request):
    return render(request, 'admin_dashboard/orders.html')
@role_required('Admin')
def admin_users(request):
    return render(request, 'admin_dashboard/users.html')
@role_required('Admin')
def admin_inventory(request):
    return render(request, 'admin_dashboard/inventory.html')
@role_required('Admin')
def admin_products(request):
    if request.method == 'POST':
        action = request.POST.get('action')
        if action == 'delete_product':
            product_id = request.POST.get('product_id')
            product = ProductCatalog.objects.filter(id=product_id).first()
            if product:
                product_name = str(product)
                product.delete()
                messages.success(request, f'Product "{product_name}" removed from catalog successfully.')
            else:
                messages.error(request, 'Product not found in catalog.')
            return redirect('admin_products')
        elif action == 'add_product':
            jersey_type = request.POST.get('jersey_type', '').strip()
            available_sizes = request.POST.getlist('available_sizes')
            on_jersey_name = request.POST.get('on_jersey_name', 'CUSTOM').strip() or 'CUSTOM'
            on_jersey_number = request.POST.get('on_jersey_number', '00').strip() or '00'
            logo_file = request.FILES.get('logo')
            design_file = request.FILES.get('design')
            if not jersey_type:
                messages.error(request, 'Jersey Type is required.')
                return redirect('admin_products')
            if not available_sizes:
                messages.error(request, 'Please select at least one available size.')
                return redirect('admin_products')
            ProductCatalog.objects.create(
                jersey_type=jersey_type,
                available_sizes=available_sizes,
                on_jersey_name=on_jersey_name,
                on_jersey_number=on_jersey_number,
                logo=logo_file,
                design=design_file,
                status='Active',
                created_by=request.user
            )
            messages.success(request, f'Added {jersey_type} ({on_jersey_name} #{on_jersey_number}) to catalog!')
            return redirect('admin_products')
        elif action == 'edit_product':
            product_id = request.POST.get('product_id')
            product = ProductCatalog.objects.filter(id=product_id).first()
            if product:
                jersey_type = request.POST.get('jersey_type', '').strip()
                available_sizes = request.POST.getlist('available_sizes')
                on_jersey_name = request.POST.get('on_jersey_name', 'CUSTOM').strip() or 'CUSTOM'
                on_jersey_number = request.POST.get('on_jersey_number', '00').strip() or '00'
                if jersey_type:
                    product.jersey_type = jersey_type
                if available_sizes:
                    product.available_sizes = available_sizes
                product.on_jersey_name = on_jersey_name
                product.on_jersey_number = on_jersey_number
                if request.FILES.get('logo'):
                    product.logo = request.FILES.get('logo')
                if request.FILES.get('design'):
                    product.design = request.FILES.get('design')
                product.save()
                messages.success(request, f'Updated "{product.jersey_type}" (ID: #{product.id}) successfully.')
            else:
                messages.error(request, 'Product not found in catalog.')
            return redirect('admin_products')
    # Ensure defaults exist if database master lists are empty
    if not MasterJerseyType.objects.exists() and not MasterSize.objects.exists():
        default_types = [
            "V-Neck Jersey",
            "Crew Neck Jersey (Round neck)",
            "Polo Jersey (With a collar)",
            "Hoodie Jersey (With a hood)",
            "Sleeveless Jersey (Tank top)",
            "Button-Up Jersey (Baseball style)"
        ]
        for t in default_types:
            MasterJerseyType.objects.get_or_create(name=t)
        default_sizes = ["S", "M", "L", "XL", "XXL", "XXXL"]
        for s in default_sizes:
            MasterSize.objects.get_or_create(name=s)
    jersey_types = MasterJerseyType.objects.all()
    sizes = MasterSize.objects.all()
    products = ProductCatalog.objects.filter(status='Active')
    context = {
        'jersey_types': jersey_types,
        'sizes': sizes,
        'products': products,
    }
    return render(request, 'admin_dashboard/products.html', context)
@role_required('Admin')
def admin_masters(request):
    return render(request, 'admin_dashboard/masters.html')
@role_required('Admin')
def admin_financials(request):
    return render(request, 'admin_dashboard/financials.html')
@role_required('Admin')
def admin_production(request):
    return render(request, 'admin_dashboard/production.html')
# Designer subpages
@role_required('Designer', 'Admin')
def designer_queue(request):
    products = ProductCatalog.objects.filter(status='Active')
    return render(request, 'designer_dashboard/queue.html', {'products': products})
@role_required('Designer', 'Admin')
def designer_canvas(request):
    products = ProductCatalog.objects.filter(status='Active')
    jersey_types = MasterJerseyType.objects.all()
    
    context = {
        'products': products,
        'jersey_types': jersey_types,
    }

    selected_order = None
    order_id = request.GET.get('order_id')
    if order_id:
        selected_order = products.filter(id=order_id.replace('PROD-', '') if order_id.startswith('PROD-') else order_id).first()
        context['selected_order'] = selected_order

    if request.method == 'POST':
        action = request.POST.get('action')
        
        # Read form inputs
        jersey_type = request.POST.get('jerseyType', '')
        player_name = request.POST.get('playerName', 'PLAYER')
        jersey_number = request.POST.get('jerseyNumber', '10')
        price_val = request.POST.get('suggestedPrice', '')
        
        # Determine product to update
        update_product = selected_order
        # if a new ID was passed via form
        form_order_id = request.POST.get('order_id')
        if form_order_id and not update_product:
            update_product = products.filter(id=form_order_id.replace('PROD-', '') if form_order_id.startswith('PROD-') else form_order_id).first()
            
        if action == 'generate':
            # Construct Prompts
            designDescription = "an aggressive, edgy, angular abstract graphic design with vibrant sublimation printing using auto and auto colors"
            if update_product and update_product.design:
                designDescription = "a sleek, dark navy blue and black gradient background covered in a fading geometric digital pixel pattern, perfectly matching the provided digital asset blueprint"
                
            logoDescription = "A custom team logo is prominently placed on the front chest."
            if update_product and update_product.logo:
                filename = os.path.basename(update_product.logo.name)
                cleanName = filename.split('.')[0].replace('-', ' ').replace('_', ' ').strip()
                if cleanName:
                    logoDescription = f"A detailed {cleanName} themed team logo is prominently placed on the front chest."
                    
            promptMockup = f'A photorealistic 3D rendering of a premium e-sports {jersey_type} jersey made of auto fabric worn by TWO invisible mannequins standing side-by-side. The left mannequin shows the FRONT view of the jersey, and the right mannequin shows the BACK view. The design MUST feature {designDescription}. The BACK view must prominently display the player name "{player_name}" and the jersey number "{jersey_number}" in a bold, blocky professional sports font. The FRONT view features {logoDescription} Professional product photography, clean gradient background, 8k resolution, cinematic studio lighting. DO NOT show sewing lines or flat panels. BOTH FRONT AND BACK VIEWS MUST BE VISIBLE.'
            
            promptCutout = f'A flat 2D vector sewing pattern template for a {jersey_type} jersey. DO NOT show a 3D jersey. DO NOT show a person or mannequin. This MUST be a perfectly flat technical blueprint layout showing BOTH the FRONT panel and the BACK panel laid out side-by-side on a pure white background, along with the left sleeve, right sleeve, and collar. The panels feature {designDescription}. The BACK panel has the name "{player_name}" and number "{jersey_number}". Include cutting lines and technical stitching measurements. Technical blueprint, flat lay, 2D only.'
            
            try:
                mockup_url, cutout_url = _generate_flux_images(promptMockup, promptCutout)
                context['generated_mockup_url'] = mockup_url
                context['generated_cutout_url'] = cutout_url
                context['success_message'] = "AI Mockup & Cutout generated successfully!"
            except Exception as e:
                context['error_message'] = f"Failed to generate AI images: {str(e)}"
                
        elif action == 'send_client':
            mockup_url_val = request.POST.get('generated_mockup_url')
            cutout_url_val = request.POST.get('generated_cutout_url')
            
            if not update_product:
                context['error_message'] = "No order selected to send."
            elif not price_val:
                context['error_message'] = "Please set a valid price."
            elif not mockup_url_val:
                context['error_message'] = "Please generate a mockup first before sending."
            else:
                # Update DB
                try:
                    update_product.unit_price = float(price_val.replace('₹','').replace(',',''))
                except ValueError:
                    pass
                update_product.order_status = 'pending_client_approval'
                
                if mockup_url_val.startswith(settings.MEDIA_URL):
                    update_product.mockup.name = mockup_url_val[len(settings.MEDIA_URL):]
                if cutout_url_val and cutout_url_val.startswith(settings.MEDIA_URL):
                    update_product.cutout.name = cutout_url_val[len(settings.MEDIA_URL):]
                
                from django.utils import timezone
                if not isinstance(update_product.history, list):
                    update_product.history = []
                update_product.history.append({'step': 'Design Sent to Client for Approval', 'at': timezone.now().isoformat()})
                update_product.save()
                
                return redirect('designer_history')

    return render(request, 'designer_dashboard/canvas.html', context)
@role_required('Designer', 'Admin')
def designer_charts(request):
    products = ProductCatalog.objects.filter(status='Active')
    return render(request, 'designer_dashboard/charts.html', {'products': products})
@role_required('Designer', 'Admin')
def designer_history(request):
    products = ProductCatalog.objects.filter(status='Active')
    return render(request, 'designer_dashboard/history.html', {'products': products})
@role_required('Designer', 'Admin')
def designer_products(request):
    jersey_types = MasterJerseyType.objects.all()
    sizes = MasterSize.objects.all()
    products = ProductCatalog.objects.filter(status='Active')
    context = {
        'jersey_types': jersey_types,
        'sizes': sizes,
        'products': products,
    }
    return render(request, 'designer_dashboard/products.html', context)
# Production subpages
@role_required('Production', 'Admin')
def prod_kanban(request):
    return render(request, 'production_dashboard/kanban.html')
@role_required('Production', 'Admin')
def prod_qc(request):
    return render(request, 'production_dashboard/qc.html')
@role_required('Production', 'Admin')
def prod_verification(request):
    return render(request, 'production_dashboard/verification.html')
@role_required('Production', 'Admin')
def prod_charts(request):
    return render(request, 'production_dashboard/charts.html')
# ===================== Admin User Management APIs =====================
@role_required('Admin')
def api_get_users(request):
    user_list = []
    for u in User.objects.all().select_related('profile'):
        role = u.profile.role if hasattr(u, 'profile') else ('Admin' if u.is_superuser else 'Designer')
        status = u.profile.status if hasattr(u, 'profile') else 'Active'
        name = u.first_name or u.username
        user_list.append({
            'id': u.id,
            'username': u.username,
            'name': name,
            'email': u.email,
            'role': role,
            'status': status
        })
    return JsonResponse({'users': user_list})
@csrf_exempt
@role_required('Admin')
def api_save_user(request):
    if request.method != 'POST':
        return JsonResponse({'error': 'POST required'}, status=400)
    try:
        data = json.loads(request.body)
        user_id = data.get('id')
        name = data.get('name', '').strip()
        email = data.get('email', '').strip()
        role = data.get('role', 'Designer')
        status = data.get('status', 'Active')
        password = data.get('password', '').strip()
        
        if not name or not email:
            return JsonResponse({'error': 'Name and email are required'}, status=400)
            
        username = email.split('@')[0] if '@' in email else email
        if not user_id or user_id == 0:
            base_username = username
            counter = 1
            while User.objects.filter(username=username).exists():
                username = f"{base_username}{counter}"
                counter += 1
                
            user = User.objects.create_user(
                username=username,
                email=email,
                password=password or 'defaultpass123',
                first_name=name
            )
            profile, _ = UserProfile.objects.get_or_create(user=user)
            profile.role = role
            profile.status = status
            profile.save()
            return JsonResponse({'success': True, 'message': 'User created successfully', 'id': user.id})
        else:
            user = User.objects.filter(id=user_id).first()
            if not user:
                return JsonResponse({'error': 'User not found'}, status=404)
            user.email = email
            user.first_name = name
            if password:
                user.set_password(password)
            user.save()
            
            profile, _ = UserProfile.objects.get_or_create(user=user)
            profile.role = role
            profile.status = status
            profile.save()
            return JsonResponse({'success': True, 'message': 'User updated successfully', 'id': user.id})
    except Exception as e:
        return JsonResponse({'error': str(e)}, status=500)
@csrf_exempt
@role_required('Admin')
def api_delete_user(request, user_id):
    if request.method not in ('POST', 'DELETE'):
        return JsonResponse({'error': 'POST or DELETE required'}, status=400)
    if request.user.id == int(user_id):
        return JsonResponse({'error': 'You cannot delete your own account'}, status=400)
    user = User.objects.filter(id=user_id).first()
    if user:
        user.delete()
        return JsonResponse({'success': True, 'message': 'User deleted successfully'})
    return JsonResponse({'error': 'User not found'}, status=404)
# ─── AUTHENTICATION & PROFILE REST API ───
@csrf_exempt
def api_login(request):
    if request.method != 'POST':
        return JsonResponse({'success': False, 'error': 'POST method required'}, status=405)
        
    try:
        data = {}
        if request.body:
            try:
                data = json.loads(request.body)
            except json.JSONDecodeError:
                pass
        if not data and request.POST:
            data = request.POST
        if not data and request.GET:
            data = request.GET
            
        login_id = str(data.get('login_id') or data.get('username') or data.get('email') or request.GET.get('login_id') or request.GET.get('username') or request.GET.get('email') or '').strip()
        password = str(data.get('password') or request.GET.get('password') or '').strip()
        
        username = login_id
        user_obj = User.objects.filter(email__iexact=login_id).first()
        if user_obj:
            username = user_obj.username
        else:
            user_obj_by_name = User.objects.filter(username__iexact=login_id).first()
            if user_obj_by_name:
                username = user_obj_by_name.username
                
        user = authenticate(request, username=username, password=password)
        if user is not None:
            if hasattr(user, 'profile'):
                role = user.profile.role
                status = user.profile.status
            elif user.is_superuser:
                role = 'Admin'
                status = 'Active'
            else:
                role = 'Designer'
                status = 'Active'
                
            if status != 'Active':
                return JsonResponse({'success': False, 'error': 'Account is disabled or inactive.'}, status=403)
                
            is_web_portal = data.get('portal') == 'web' or data.get('source') == 'web'
            if is_web_portal and role not in ('Admin', 'Designer', 'Production') and not user.is_superuser:
                return JsonResponse({
                    'success': False,
                    'error': 'Access Denied: End-user accounts do not have a web dashboard. Please log in through the mobile app via API.'
                }, status=403)
                
            login(request, user)
            
            redirect_url = None
            if role == 'Admin' or user.is_superuser:
                redirect_url = '/admin.html'
            elif role == 'Designer':
                redirect_url = '/designer.html'
            elif role == 'Production':
                redirect_url = '/production.html'
                
            profile = getattr(user, 'profile', None)
            if not profile:
                profile = UserProfile.objects.create(user=user, role='Admin' if user.is_superuser else 'Designer', status='Active')
            token = profile.generate_bearer_token(force_new=False)
                
            return JsonResponse({
                'success': True,
                'message': 'Authentication successful',
                'token_type': 'Bearer',
                'bearer_token': token,
                'access_token': token,
                'token': token,
                'user': {
                    'id': user.id,
                    'username': user.username,
                    'name': user.first_name or user.username,
                    'email': user.email,
                    'role': role,
                    'status': status,
                    'phone': getattr(profile, 'phone', '') or '',
                    'token_type': 'Bearer',
                    'bearer_token': token,
                    'token': token
                },
                'redirect_url': redirect_url
            })
        else:
            return JsonResponse({'success': False, 'error': 'Invalid username/email or password.'}, status=401)
    except Exception as e:
        return JsonResponse({'success': False, 'error': f'Authentication failure: {str(e)}'}, status=500)
@csrf_exempt
def api_register(request):
    if request.method != 'POST':
        return JsonResponse({'success': False, 'error': 'POST request required'}, status=405)
    try:
        data = {}
        if request.body:
            try:
                data = json.loads(request.body)
            except json.JSONDecodeError:
                pass
        if not data and request.POST:
            data = request.POST
        if not data and request.GET:
            data = request.GET
        phone_raw = str(data.get('phone') or request.GET.get('phone') or request.POST.get('phone') or '')
        phone = ('+' + phone_raw.strip()) if phone_raw.startswith(' ') else phone_raw.strip()
        otp_submitted = str(data.get('otp') or request.GET.get('otp') or request.POST.get('otp') or '').strip()
        username = str(data.get('username') or phone or data.get('email') or request.GET.get('email') or '').strip()
        password = str(data.get('password') or '').strip()
        name = str(data.get('name') or request.GET.get('name') or data.get('first_name') or '').strip()
        email = str(data.get('email') or request.GET.get('email') or data.get('smail') or request.GET.get('smail') or '').strip()
        if not username and not phone:
            return JsonResponse({'success': False, 'error': 'Username, email, or phone is required to register.'}, status=400)
        if not password and not otp_submitted:
            return JsonResponse({'success': False, 'error': 'Either an OTP code or a password is required to register.'}, status=400)
        if username and User.objects.filter(username__iexact=username).exists():
            return JsonResponse({'success': False, 'error': 'An account with this identifier/phone already exists. Please log in via /api/auth/verify-otp/.'}, status=400)
        if phone and UserProfile.objects.filter(phone=phone).exists():
            return JsonResponse({'success': False, 'error': 'An account with this phone number already exists. Please log in via /api/auth/verify-otp/.'}, status=400)
        # If OTP is provided, validate it before creating the account
        if otp_submitted:
            if not phone:
                return JsonResponse({'success': False, 'error': 'Phone number is required when registering with OTP.'}, status=400)
            is_dev_master = (otp_submitted == '123456')
            if not is_dev_master:
                matching_record = OTPVerification.objects.filter(phone=phone, otp=otp_submitted, is_used=False).order_by('-created_at').first()
                if not matching_record or not matching_record.is_valid():
                    return JsonResponse({'success': False, 'error': 'Invalid or expired OTP code. Notice: codes expire after 5 minutes.'}, status=400)
                matching_record.is_used = True
                matching_record.save()
            if not password:
                password = f"otp_auth_{random.randint(10000000, 99999999)}"
        user = User.objects.create_user(
            username=username,
            password=password,
            first_name=name or f"User {phone[-4:] if len(phone)>=4 else username}",
            email=email
        )
        profile, _ = UserProfile.objects.get_or_create(user=user)
        profile.role = data.get('role') or 'User'
        profile.status = 'Active'
        if phone:
            profile.phone = phone
        profile.save()
        token = profile.generate_bearer_token(force_new=True)
        login(request, user)
        return JsonResponse({
            'success': True,
            'message': 'User registration successful with Bearer token generated',
            'action': 'register',
            'token_type': 'Bearer',
            'bearer_token': token,
            'access_token': token,
            'token': token,
            'user': {
                'id': user.id,
                'username': user.username,
                'name': user.first_name or user.username,
                'email': user.email,
                'role': profile.role,
                'status': profile.status,
                'phone': profile.phone or '',
                'token_type': 'Bearer',
                'bearer_token': token,
                'token': token,
                'initial': (user.first_name or user.username or 'U')[0].upper()
            }
        })
    except Exception as e:
        return JsonResponse({'success': False, 'error': f'Registration failed: {str(e)}'}, status=500)
@csrf_exempt
def api_logout(request):
    logout(request)
    return JsonResponse({'success': True, 'message': 'Logged out successfully'})
def api_current_user(request):
    user = request.user
    if not user.is_authenticated:
        auth_header = request.headers.get('Authorization') or request.META.get('HTTP_AUTHORIZATION') or ''
        if auth_header.lower().startswith('bearer '):
            token_str = auth_header.split(' ', 1)[1].strip()
            prof = UserProfile.objects.filter(api_token=token_str).first()
            if prof and prof.user and prof.status == 'Active' and prof.user.is_active:
                user = prof.user
    if not user.is_authenticated and not getattr(user, 'id', None):
        return JsonResponse({'success': False, 'error': 'Unauthenticated'}, status=401)
        
    profile = getattr(user, 'profile', None)
    role = getattr(profile, 'role', 'Admin' if user.is_superuser else 'Designer')
    status = getattr(profile, 'status', 'Active')
    phone = getattr(profile, 'phone', '') or ''
    token = profile.generate_bearer_token(force_new=False) if profile else ''
    
    return JsonResponse({
        'success': True,
        'user': {
            'id': user.id,
            'username': user.username,
            'name': user.first_name or user.username,
            'email': user.email,
            'role': role,
            'status': status,
            'phone': phone,
            'token_type': 'Bearer',
            'bearer_token': token,
            'token': token,
            'initial': (user.first_name or user.username or 'U')[0].upper()
        }
    })
# ===================== Phone Number & OTP Authentication APIs =====================
@csrf_exempt
def api_send_otp(request):
    if request.method != 'POST':
        return JsonResponse({'success': False, 'error': 'POST required'}, status=405)
    try:
        data = {}
        if request.body:
            try:
                data = json.loads(request.body)
            except json.JSONDecodeError:
                pass
        if not data and request.POST:
            data = request.POST
        if not data and request.GET:
            data = request.GET
        phone_raw = str(data.get('phone') or request.GET.get('phone') or request.POST.get('phone') or '')
        phone = ('+' + phone_raw.strip()) if phone_raw.startswith(' ') else phone_raw.strip()
        if not phone:
            return JsonResponse({'success': False, 'error': 'Phone number is required'}, status=400)
        # Detect whether an account exists with this phone number
        existing_profile = UserProfile.objects.filter(phone=phone).first()
        existing_user = existing_profile.user if existing_profile else User.objects.filter(username=phone).first()
        action = 'login' if existing_user else 'register'
        # Generate secure 6-digit OTP code
        otp_code = f"{random.randint(100000, 999999)}"
        # Save verification record with 5-minute expiry logic
        OTPVerification.objects.create(
            phone=phone,
            otp=otp_code,
            action=action
        )
        return JsonResponse({
            'success': True,
            'message': f"OTP sent successfully for {action}",
            'action': action,
            'dev_otp': otp_code,
            'expiry_minutes': 5
        })
    except Exception as e:
        return JsonResponse({'success': False, 'error': f'Failed to generate OTP: {str(e)}'}, status=500)
@csrf_exempt
def api_verify_otp(request):
    if request.method != 'POST':
        return JsonResponse({'success': False, 'error': 'POST required'}, status=405)
    try:
        data = {}
        if request.body:
            try:
                data = json.loads(request.body)
            except json.JSONDecodeError:
                pass
        if not data and request.POST:
            data = request.POST
        if not data and request.GET:
            data = request.GET
        phone_raw = str(data.get('phone') or request.GET.get('phone') or request.POST.get('phone') or '')
        phone = ('+' + phone_raw.strip()) if phone_raw.startswith(' ') else phone_raw.strip()
        otp_submitted = str(data.get('otp') or request.GET.get('otp') or request.POST.get('otp') or '').strip()
        name = str(data.get('name') or request.GET.get('name') or request.POST.get('name') or '').strip()
        email = str(data.get('email') or request.GET.get('email') or data.get('smail') or request.GET.get('smail') or request.POST.get('smail') or '').strip()
        if not phone or not otp_submitted:
            return JsonResponse({'success': False, 'error': 'Phone number and OTP are required'}, status=400)
        existing_profile = UserProfile.objects.filter(phone=phone).first()
        user = existing_profile.user if existing_profile else User.objects.filter(username=phone).first()
        if not user:
            return JsonResponse({
                'success': False,
                'error': 'No account exists with this phone number. Please register via /api/auth/register/ first.',
                'action': 'register_required'
            }, status=404)
        # Check OTP (support universal dev code '123456' or validate database records within 5 minutes)
        is_dev_master = (otp_submitted == '123456')
        if not is_dev_master:
            matching_record = OTPVerification.objects.filter(phone=phone, otp=otp_submitted, is_used=False).order_by('-created_at').first()
            if not matching_record or not matching_record.is_valid():
                return JsonResponse({'success': False, 'error': 'Invalid or expired OTP code. Notice: codes expire after 5 minutes.'}, status=400)
            matching_record.is_used = True
            matching_record.save()
        # Existing account -> Login
        profile = getattr(user, 'profile', None)
        if profile and profile.status == 'Inactive':
            return JsonResponse({'success': False, 'error': 'Your account has been deactivated.'}, status=403)
        if not profile:
            profile = UserProfile.objects.create(user=user, role='User', status='Active', phone=phone)
        elif not profile.phone:
            profile.phone = phone
            profile.save()
        
        token = profile.generate_bearer_token(force_new=False)
        login(request, user)
        return JsonResponse({
            'success': True,
            'message': 'Login successful via OTP with Bearer token',
            'action': 'login',
            'token_type': 'Bearer',
            'bearer_token': token,
            'access_token': token,
            'token': token,
            'user': {
                'id': user.id,
                'username': user.username,
                'name': user.first_name or user.username,
                'email': user.email,
                'role': profile.role,
                'status': profile.status,
                'phone': profile.phone or '',
                'token_type': 'Bearer',
                'bearer_token': token,
                'token': token,
                'initial': (user.first_name or user.username or 'U')[0].upper()
            }
        })
    except Exception as e:
        return JsonResponse({'success': False, 'error': f'OTP verification failure: {str(e)}'}, status=500)
# Backward compatibility alias
api_register_otp = api_register
@csrf_exempt
def api_check_user(request):
    try:
        data = {}
        if request.body:
            try:
                data = json.loads(request.body)
            except json.JSONDecodeError:
                pass
        if not data and request.POST:
            data = request.POST
        if not data and request.GET:
            data = request.GET
        # 1. Check via Authorization Bearer token header or token parameter
        auth_header = request.headers.get('Authorization') or request.META.get('HTTP_AUTHORIZATION') or ''
        token_str = ''
        if auth_header.lower().startswith('bearer '):
            token_str = auth_header.split(' ', 1)[1].strip()
        elif data.get('token') or request.GET.get('token') or request.POST.get('token'):
            token_str = str(data.get('token') or request.GET.get('token') or request.POST.get('token')).strip()
        if token_str:
            profile = UserProfile.objects.filter(api_token=token_str).first()
            if not profile or not profile.user:
                return JsonResponse({
                    'success': True,
                    'exists': False,
                    'valid': False,
                    'message': 'No existing account found for this Bearer token.'
                })
            if profile.status == 'Inactive' or not profile.user.is_active:
                return JsonResponse({
                    'success': True,
                    'exists': True,
                    'valid': False,
                    'error': 'User account exists but is deactivated or inactive.'
                }, status=403)
            user = profile.user
            return JsonResponse({
                'success': True,
                'exists': True,
                'valid': True,
                'message': 'User exists and Bearer token is valid.',
                'user': {
                    'id': user.id,
                    'username': user.username,
                    'name': user.first_name or user.username,
                    'email': user.email,
                    'role': profile.role,
                    'status': profile.status,
                    'phone': profile.phone or '',
                    'token': profile.api_token,
                    'initial': (user.first_name or user.username or 'U')[0].upper()
                }
            })
        # 2. Check via phone, email, or username parameter
        phone_raw = str(data.get('phone') or request.GET.get('phone') or request.POST.get('phone') or '')
        phone = ('+' + phone_raw.strip()) if phone_raw.startswith(' ') else phone_raw.strip()
        email = str(data.get('email') or request.GET.get('email') or data.get('smail') or request.GET.get('smail') or '').strip()
        username = str(data.get('username') or request.GET.get('username') or '').strip()
        if not phone and not email and not username:
            return JsonResponse({
                'success': False,
                'exists': False,
                'error': 'Please provide an Authorization Bearer token header or a phone, email, or username parameter.'
            }, status=400)
        existing_user = None
        if phone:
            prof = UserProfile.objects.filter(phone=phone).first()
            existing_user = prof.user if prof else User.objects.filter(username=phone).first()
        if not existing_user and email:
            existing_user = User.objects.filter(email__iexact=email).first()
        if not existing_user and username:
            existing_user = User.objects.filter(username__iexact=username).first()
        if existing_user:
            prof = getattr(existing_user, 'profile', None)
            is_active = (not prof or prof.status == 'Active') and existing_user.is_active
            return JsonResponse({
                'success': True,
                'exists': True,
                'valid': is_active,
                'action': 'login',
                'message': 'User already exists in the system.'
            })
        else:
            return JsonResponse({
                'success': True,
                'exists': False,
                'valid': False,
                'action': 'register',
                'message': 'User does not exist in the system.'
            })
    except Exception as e:
        return JsonResponse({'success': False, 'error': f'Failed to check user existence: {str(e)}'}, status=500)
@csrf_exempt
def api_masters(request):
    """
    API endpoint to retrieve Available Sizes Master List and Jersey Types Master List from Admin dashboard.
    Required Parameter: Bearer token (can be supplied as ?token=... or ?bearer_token=... or in Authorization header).
    """
    try:
        data = {}
        if request.body:
            try:
                data = json.loads(request.body)
            except json.JSONDecodeError:
                pass
        if not data and request.POST:
            data = request.POST
        if not data and request.GET:
            data = request.GET
        # Extract Bearer Token parameter or Authorization header
        auth_header = request.headers.get('Authorization') or request.META.get('HTTP_AUTHORIZATION') or ''
        token_str = ''
        if auth_header.lower().startswith('bearer '):
            token_str = auth_header.split(' ', 1)[1].strip()
        elif data.get('token') or request.GET.get('token') or data.get('bearer_token') or request.GET.get('bearer_token'):
            token_str = str(data.get('token') or request.GET.get('token') or data.get('bearer_token') or request.GET.get('bearer_token')).strip()
        if not token_str:
            return JsonResponse({
                'success': False,
                'error': 'Authentication failed: Bearer token parameter is required (e.g., ?token=YOUR_BEARER_TOKEN or Authorization: Bearer <token>)'
            }, status=401)
        profile = UserProfile.objects.filter(api_token=token_str).first()
        if not profile:
            return JsonResponse({
                'success': False,
                'error': 'Invalid or expired Bearer token parameter'
            }, status=401)
        if profile.status == 'Inactive':
            return JsonResponse({
                'success': False,
                'error': 'User account associated with this token is currently inactive'
            }, status=403)
        # Ensure defaults are initialized if database master lists are empty
        if not MasterJerseyType.objects.exists() and not MasterSize.objects.exists():
            default_types = [
                "V-Neck Jersey",
                "Crew Neck Jersey (Round neck)",
                "Polo Jersey (With a collar)",
                "Hoodie Jersey (With a hood)",
                "Sleeveless Jersey (Tank top)",
                "Button-Up Jersey (Baseball style)"
            ]
            for t in default_types:
                MasterJerseyType.objects.get_or_create(name=t)
            default_sizes = ["S", "M", "L", "XL", "XXL", "XXXL"]
            for s in default_sizes:
                MasterSize.objects.get_or_create(name=s)
        # Handle optional dynamic additions/removals if admin or API client specifies action
        action = data.get('action') or request.GET.get('action')
        if action in ['add_type', 'add_jersey_type'] and data.get('name'):
            new_type = str(data.get('name')).strip()
            if new_type:
                MasterJerseyType.objects.get_or_create(name=new_type)
        elif action in ['add_size'] and data.get('name'):
            new_size = str(data.get('name')).strip().upper()
            if new_size:
                MasterSize.objects.get_or_create(name=new_size)
        elif action in ['delete_type', 'remove_type'] and data.get('name'):
            MasterJerseyType.objects.filter(name__iexact=str(data.get('name')).strip()).delete()
        elif action in ['delete_size', 'remove_size'] and data.get('name'):
            MasterSize.objects.filter(name__iexact=str(data.get('name')).strip()).delete()
        jersey_types_list = list(MasterJerseyType.objects.values_list('name', flat=True))
        available_sizes_list = list(MasterSize.objects.values_list('name', flat=True))
        return JsonResponse({
            'success': True,
            'message': 'Master lists fetched successfully',
            'jersey_types': jersey_types_list,
            'available_sizes': available_sizes_list,
            'jersey_types_master_list': jersey_types_list,
            'available_sizes_master_list': available_sizes_list,
        })
    except Exception as e:
        return JsonResponse({'success': False, 'error': f'Failed to fetch master lists: {str(e)}'}, status=500)
@csrf_exempt
def api_products(request):
    try:
        # --- Auth: support both session auth and bearer token ---
        profile = None
        # 1. Session auth (logged-in user from admin dashboard)
        if request.user.is_authenticated:
            profile = getattr(request.user, 'profile', None)
        else:
            # 2. Bearer token auth (external API)
            auth_header = request.headers.get('Authorization') or request.META.get('HTTP_AUTHORIZATION') or ''
            token_str = ''
            if auth_header.lower().startswith('bearer '):
                token_str = auth_header.split(' ', 1)[1].strip()
            else:
                token_str = (
                    request.GET.get('token') or request.GET.get('bearer_token') or
                    request.POST.get('token') or request.POST.get('bearer_token') or ''
                )
                token_str = str(token_str).strip()
            if not token_str:
                return JsonResponse({
                    'success': False,
                    'error': 'Authentication failed: Bearer token is required (e.g., ?token=YOUR_BEARER_TOKEN or Authorization: Bearer <token>)'
                }, status=401)
            profile = UserProfile.objects.filter(api_token=token_str).first()
            if not profile:
                return JsonResponse({'success': False, 'error': 'Invalid or expired Bearer token'}, status=401)
        if not profile:
            return JsonResponse({'success': False, 'error': 'Authentication required'}, status=401)
        if profile.status == 'Inactive':
            return JsonResponse({'success': False, 'error': 'User account is inactive'}, status=403)
        # ── POST: Add New Jersey Product ──
        if request.method == 'POST':
            jersey_type = (request.POST.get('jersey_type') or '').strip()
            sizes_raw = request.POST.get('available_sizes') or '[]'
            on_jersey_name = (request.POST.get('on_jersey_name') or 'CUSTOM').strip()
            on_jersey_number = (request.POST.get('on_jersey_number') or '00').strip()
            # Parse JSON body fallback (for non-form requests)
            if not jersey_type and request.content_type and 'json' in request.content_type:
                try:
                    body = json.loads(request.body)
                    jersey_type = str(body.get('jersey_type', '')).strip()
                    sizes_raw = body.get('available_sizes', '[]')
                    on_jersey_name = str(body.get('on_jersey_name', 'CUSTOM')).strip()
                    on_jersey_number = str(body.get('on_jersey_number', '00')).strip()
                except json.JSONDecodeError:
                    pass
            if not jersey_type:
                return JsonResponse({'success': False, 'error': 'jersey_type is required'}, status=400)
            # Parse sizes
            if isinstance(sizes_raw, str):
                try:
                    available_sizes = json.loads(sizes_raw)
                except json.JSONDecodeError:
                    available_sizes = [s.strip() for s in sizes_raw.split(',') if s.strip()]
            elif isinstance(sizes_raw, list):
                available_sizes = sizes_raw
            else:
                available_sizes = []
            if not available_sizes:
                return JsonResponse({'success': False, 'error': 'At least one available size is required'}, status=400)
            # Handle file uploads
            logo_file = request.FILES.get('logo')
            design_file = request.FILES.get('design')
            product = ProductCatalog.objects.create(
                jersey_type=jersey_type,
                available_sizes=available_sizes,
                on_jersey_name=on_jersey_name,
                on_jersey_number=on_jersey_number,
                logo=logo_file,
                design=design_file,
                status='Active',
                created_by=profile.user
            )
            return JsonResponse({
                'success': True,
                'message': f'Product "{jersey_type} - {on_jersey_name} #{on_jersey_number}" added successfully',
                'product': {
                    'id': product.id,
                    'jersey_type': product.jersey_type,
                    'available_sizes': product.available_sizes,
                    'on_jersey_name': product.on_jersey_name,
                    'on_jersey_number': product.on_jersey_number,
                    'logo': product.logo.url if product.logo else None,
                    'design': product.design.url if product.design else None,
                    'status': product.status,
                    'created_by': product.created_by.id if product.created_by else None,
                    'created_by_username': product.created_by.username if product.created_by else None,
                    'created_at': product.created_at.isoformat(),
                }
            }, status=201)
        # ── GET: List Product Catalog ──
        # Optional filter: ?status=all (default: Active only)
        status_filter = request.GET.get('status', 'Active').strip()
        if status_filter.lower() == 'all':
            products = ProductCatalog.objects.all()
        else:
            products = ProductCatalog.objects.filter(status=status_filter)
        products_list = []
        for p in products:
            products_list.append({
                'id': p.id,
                'jersey_type': p.jersey_type,
                'available_sizes': p.available_sizes,
                'on_jersey_name': p.on_jersey_name,
                'on_jersey_number': p.on_jersey_number,
                'logo': request.build_absolute_uri(p.logo.url) if p.logo else None,
                'design': request.build_absolute_uri(p.design.url) if p.design else None,
                'status': p.status,
                'order_status': p.order_status,
                'unit_price': str(p.unit_price),
                'history': p.history,
                'created_by': p.created_by.id if p.created_by else None,
                'created_by_username': p.created_by.username if p.created_by else None,
                'created_at': p.created_at.isoformat(),
                'updated_at': p.updated_at.isoformat(),
            })
        return JsonResponse({
            'success': True,
            'message': 'Product catalog fetched successfully',
            'count': len(products_list),
            'products': products_list
        })
    except Exception as e:
        return JsonResponse({'success': False, 'error': f'Product catalog operation failed: {str(e)}'}, status=500)
@csrf_exempt
def api_delete_product(request, product_id):
    """
    DELETE /api/products/delete/<product_id>/
    Remove a product from the catalog.
    Authentication: Bearer token.
    """
    try:
        # --- Auth: support both session auth and bearer token ---
        profile = None
        if request.user.is_authenticated:
            profile = getattr(request.user, 'profile', None)
        else:
            auth_header = request.headers.get('Authorization') or request.META.get('HTTP_AUTHORIZATION') or ''
            token_str = ''
            if auth_header.lower().startswith('bearer '):
                token_str = auth_header.split(' ', 1)[1].strip()
            else:
                token_str = (
                    request.GET.get('token') or request.GET.get('bearer_token') or
                    request.POST.get('token') or request.POST.get('bearer_token') or ''
                )
                token_str = str(token_str).strip()
            if not token_str:
                return JsonResponse({'success': False, 'error': 'Bearer token is required'}, status=401)
            profile = UserProfile.objects.filter(api_token=token_str).first()
            if not profile:
                return JsonResponse({'success': False, 'error': 'Invalid or expired Bearer token'}, status=401)
        if not profile:
            return JsonResponse({'success': False, 'error': 'Authentication required'}, status=401)
        if profile.status == 'Inactive':
            return JsonResponse({'success': False, 'error': 'User account is inactive'}, status=403)
        product = ProductCatalog.objects.filter(id=product_id).first()
        if not product:
            return JsonResponse({'success': False, 'error': f'Product with id {product_id} not found'}, status=404)
        product_name = str(product)
        product.delete()
        return JsonResponse({
            'success': True,
            'message': f'Product "{product_name}" has been removed from catalog'
        })
    except Exception as e:
        return JsonResponse({'success': False, 'error': f'Failed to delete product: {str(e)}'}, status=500)
# ─── Helper: extract authenticated profile from request (session or Bearer token) ───
def _get_auth_profile(request):
    """Return the UserProfile for the authenticated user, or None."""
    if request.user.is_authenticated:
        return getattr(request.user, 'profile', None)
    auth_header = request.headers.get('Authorization') or request.META.get('HTTP_AUTHORIZATION') or ''
    token_str = ''
    if auth_header.lower().startswith('bearer '):
        token_str = auth_header.split(' ', 1)[1].strip()
    else:
        token_str = str(
            request.GET.get('token') or request.GET.get('bearer_token') or
            request.POST.get('token') or request.POST.get('bearer_token') or ''
        ).strip()
    if not token_str:
        return None
    return UserProfile.objects.filter(api_token=token_str).first()
@csrf_exempt
def api_product_detail(request, product_id):
    """
    GET /api/products/<product_id>/
    Retrieve full details of a single product by its ID.
    Authentication: Bearer token or session.
    """
    try:
        profile = _get_auth_profile(request)
        if not profile:
            return JsonResponse({
                'success': False,
                'error': 'Authentication required: provide a Bearer token (e.g., ?token=YOUR_TOKEN or Authorization: Bearer <token>)'
            }, status=401)
        if profile.status == 'Inactive':
            return JsonResponse({'success': False, 'error': 'User account is inactive'}, status=403)
        product = ProductCatalog.objects.filter(id=product_id).first()
        if not product:
            return JsonResponse({'success': False, 'error': f'Product with id {product_id} not found'}, status=404)
        return JsonResponse({
            'success': True,
            'message': 'Product details fetched successfully',
            'product': {
                'id': product.id,
                'jersey_type': product.jersey_type,
                'available_sizes': product.available_sizes,
                'on_jersey_name': product.on_jersey_name,
                'on_jersey_number': product.on_jersey_number,
                'logo': request.build_absolute_uri(product.logo.url) if product.logo else None,
                'design': request.build_absolute_uri(product.design.url) if product.design else None,
                'status': product.status,
                'order_status': product.order_status,
                'unit_price': str(product.unit_price),
                'history': product.history,
                'created_by': product.created_by.id if product.created_by else None,
                'created_by_username': product.created_by.username if product.created_by else None,
                'created_at': product.created_at.isoformat(),
                'updated_at': product.updated_at.isoformat(),
            }
        })
    except Exception as e:
        return JsonResponse({'success': False, 'error': f'Failed to fetch product detail: {str(e)}'}, status=500)
@csrf_exempt
def api_update_product(request, product_id):
    """
    POST/PUT /api/products/<product_id>/update/
    Update an existing product's fields and/or images.
    Accepts multipart/form-data (for file uploads) or JSON body.
    Authentication: Bearer token or session.
    """
    if request.method not in ('POST', 'PUT', 'PATCH'):
        return JsonResponse({'success': False, 'error': 'POST, PUT or PATCH required'}, status=405)
    try:
        profile = _get_auth_profile(request)
        if not profile:
            return JsonResponse({
                'success': False,
                'error': 'Authentication required: provide a Bearer token'
            }, status=401)
        if profile.status == 'Inactive':
            return JsonResponse({'success': False, 'error': 'User account is inactive'}, status=403)
        product = ProductCatalog.objects.filter(id=product_id).first()
        if not product:
            return JsonResponse({'success': False, 'error': f'Product with id {product_id} not found'}, status=404)
        # Parse fields from form-data or JSON body
        jersey_type = (request.POST.get('jersey_type') or '').strip()
        sizes_raw = request.POST.get('available_sizes')
        on_jersey_name = (request.POST.get('on_jersey_name') or '').strip()
        on_jersey_number = (request.POST.get('on_jersey_number') or '').strip()
        status_val = (request.POST.get('status') or '').strip()
        # JSON body fallback
        if not jersey_type and request.content_type and 'json' in request.content_type:
            try:
                body = json.loads(request.body)
                jersey_type = str(body.get('jersey_type', '')).strip()
                sizes_raw = body.get('available_sizes')
                on_jersey_name = str(body.get('on_jersey_name', '')).strip()
                on_jersey_number = str(body.get('on_jersey_number', '')).strip()
                status_val = str(body.get('status', '')).strip()
            except json.JSONDecodeError:
                pass
        
        order_status_val = (request.POST.get('order_status') or '').strip()
        unit_price_val = (request.POST.get('unit_price') or '').strip()
        history_step = (request.POST.get('history_step') or '').strip()
        mockup_url_val = (request.POST.get('mockup_url') or '').strip()
        cutout_url_val = (request.POST.get('cutout_url') or '').strip()
        if not order_status_val and request.content_type and 'json' in request.content_type:
            try:
                body = json.loads(request.body)
                order_status_val = str(body.get('order_status', '')).strip()
                unit_price_val = str(body.get('unit_price', '')).strip()
                history_step = str(body.get('history_step', '')).strip()
                mockup_url_val = str(body.get('mockup_url', '')).strip()
                cutout_url_val = str(body.get('cutout_url', '')).strip()
            except json.JSONDecodeError:
                pass
        # Apply updates (only non-empty fields)
        if jersey_type:
            product.jersey_type = jersey_type
        if on_jersey_name:
            product.on_jersey_name = on_jersey_name
        if on_jersey_number:
            product.on_jersey_number = on_jersey_number
        if status_val in ('Active', 'Inactive'):
            product.status = status_val
        if order_status_val:
            product.order_status = order_status_val
        if unit_price_val:
            try:
                product.unit_price = float(unit_price_val)
            except ValueError:
                pass
        
        # If mockup or cutout URLs are provided via form data (strings), strip media prefix and save relative path
        if mockup_url_val:
            if mockup_url_val.startswith(settings.MEDIA_URL):
                product.mockup.name = mockup_url_val[len(settings.MEDIA_URL):]
            else:
                product.mockup.name = mockup_url_val
        if cutout_url_val:
            if cutout_url_val.startswith(settings.MEDIA_URL):
                product.cutout.name = cutout_url_val[len(settings.MEDIA_URL):]
            else:
                product.cutout.name = cutout_url_val
                
        if history_step:
            if not isinstance(product.history, list):
                product.history = []
            product.history.append({'step': history_step, 'at': timezone.now().isoformat()})
        # Parse sizes if provided
        if sizes_raw is not None:
            if isinstance(sizes_raw, str):
                try:
                    available_sizes = json.loads(sizes_raw)
                except json.JSONDecodeError:
                    available_sizes = [s.strip() for s in sizes_raw.split(',') if s.strip()]
            elif isinstance(sizes_raw, list):
                available_sizes = sizes_raw
            else:
                available_sizes = None
            if available_sizes is not None:
                product.available_sizes = available_sizes
        # Handle file uploads
        logo_file = request.FILES.get('logo')
        design_file = request.FILES.get('design')
        mockup_file = request.FILES.get('mockup')
        if logo_file:
            product.logo = logo_file
        if design_file:
            product.design = design_file
        if mockup_file:
            product.mockup = mockup_file
        product.save()
        return JsonResponse({
            'success': True,
            'message': f'Product "{product}" updated successfully',
            'product': {
                'id': product.id,
                'jersey_type': product.jersey_type,
                'available_sizes': product.available_sizes,
                'on_jersey_name': product.on_jersey_name,
                'on_jersey_number': product.on_jersey_number,
                'logo': request.build_absolute_uri(product.logo.url) if product.logo else None,
                'design': request.build_absolute_uri(product.design.url) if product.design else None,
                'mockup': request.build_absolute_uri(product.mockup.url) if product.mockup else None,
                'status': product.status,
                'order_status': product.order_status,
                'unit_price': str(product.unit_price),
                'history': product.history,
                'created_by': product.created_by.id if product.created_by else None,
                'created_by_username': product.created_by.username if product.created_by else None,
                'created_at': product.created_at.isoformat(),
                'updated_at': product.updated_at.isoformat(),
            }
        })
    except Exception as e:
        return JsonResponse({'success': False, 'error': f'Failed to update product: {str(e)}'}, status=500)
@csrf_exempt
@role_required('Designer', 'Production', 'Admin')
def api_generate_image(request):
    if request.method == 'POST':
        try:
            data = json.loads(request.body)
            prompt = data.get('prompt')
            if not prompt:
                return JsonResponse({'success': False, 'error': 'Prompt is required'})
            api_key = os.getenv('FLUX_API_KEY')
            if not api_key:
                return JsonResponse({'success': False, 'error': 'FLUX_API_KEY not found in environment'})
            headers = {
                'Authorization': f'Bearer {api_key}',
                'Content-Type': 'application/json',
            }
            
            payload = {
                'prompt': prompt,
                'aspectRatio': '16:9',
                'model': 'flux-kontext-pro'
            }
            res = requests.post("https://api.fluxapi.ai/api/v1/flux/kontext/generate", headers=headers, json=payload)
            if not res.ok:
                return JsonResponse({'success': False, 'error': f'Flux API error: {res.text}'})
            
            task_data = res.json()
            if task_data.get('code') != 200:
                 return JsonResponse({'success': False, 'error': f'Flux API error: {task_data.get("msg")}'})
            
            task_id = task_data.get('data', {}).get('taskId')
            if not task_id:
                 return JsonResponse({'success': False, 'error': 'No task ID returned from Flux API'})
            import time
            max_attempts = 45 # wait up to 90 seconds
            result_url = None
            for _ in range(max_attempts):
                time.sleep(2)
                poll_res = requests.get(f"https://api.fluxapi.ai/api/v1/flux/kontext/record-info?taskId={task_id}", headers=headers)
                if poll_res.ok:
                    poll_data = poll_res.json()
                    if poll_data.get('code') == 200:
                        status = poll_data.get('data', {}).get('successFlag')
                        if status == 1:
                            result_url = poll_data.get('data', {}).get('response', {}).get('resultImageUrl')
                            break
                        elif status == 2 or status == 3:
                            return JsonResponse({'success': False, 'error': f'Flux API generation failed (Status {status}). Please try again.'})
            
            if not result_url:
                return JsonResponse({'success': False, 'error': 'Flux API generation timed out'})
            
            img_res = requests.get(result_url)
            if img_res.status_code == 200:
                generated_dir = os.path.join(settings.MEDIA_ROOT, 'generated')
                os.makedirs(generated_dir, exist_ok=True)
                
                filename = f"flux_{uuid.uuid4().hex[:8]}.jpeg"
                file_path = os.path.join(generated_dir, filename)
                with open(file_path, 'wb') as f:
                    f.write(img_res.content)
                
                img_url = f"{settings.MEDIA_URL}generated/{filename}"
                return JsonResponse({'success': True, 'image_url': img_url})
            else:
                return JsonResponse({'success': False, 'error': 'Failed to download generated image'})
                
        except Exception as e:
            return JsonResponse({'success': False, 'error': str(e)})
    return JsonResponse({'success': False, 'error': 'Invalid request method'})


def _generate_flux_images(prompt_mockup, prompt_cutout):
    api_key = os.getenv('FLUX_API_KEY')
    if not api_key:
        raise ValueError('FLUX_API_KEY not found in environment')
        
    headers = {
        'Authorization': f'Bearer {api_key}',
        'Content-Type': 'application/json',
    }
    
    # Send Mockup Request
    payload_mockup = {'prompt': prompt_mockup, 'aspectRatio': '16:9', 'model': 'flux-kontext-pro'}
    res_mockup = requests.post("https://api.fluxapi.ai/api/v1/flux/kontext/generate", headers=headers, json=payload_mockup)
    if not res_mockup.ok:
        raise ValueError(f'Flux API error (mockup): {res_mockup.text}')
    task_data_m = res_mockup.json()
    if task_data_m.get('code') != 200:
        raise ValueError(f"Flux API error (mockup): {task_data_m.get('msg')}")
    task_id_m = (task_data_m.get('data') or {}).get('taskId')
    
    # Send Cutout Request
    payload_cutout = {'prompt': prompt_cutout, 'aspectRatio': '16:9', 'model': 'flux-kontext-pro'}
    res_cutout = requests.post("https://api.fluxapi.ai/api/v1/flux/kontext/generate", headers=headers, json=payload_cutout)
    if not res_cutout.ok:
        raise ValueError(f'Flux API error (cutout): {res_cutout.text}')
    task_data_c = res_cutout.json()
    if task_data_c.get('code') != 200:
        raise ValueError(f"Flux API error (cutout): {task_data_c.get('msg')}")
    task_id_c = (task_data_c.get('data') or {}).get('taskId')
    
    if not task_id_m or not task_id_c:
        raise ValueError('Failed to get task IDs from Flux API')
         
    import time
    max_attempts = 150 # wait up to 300 seconds (5 mins)
    url_m = None
    url_c = None
    
    for attempt in range(max_attempts):
        time.sleep(2)
        
        # Poll Mockup if not yet done
        if not url_m:
            poll_m = requests.get(f"https://api.fluxapi.ai/api/v1/flux/kontext/record-info?taskId={task_id_m}", headers=headers)
            if poll_m.ok:
                pd_m = poll_m.json()
                if pd_m.get('code') == 200:
                    p_data = pd_m.get('data') or {}
                    status_m = p_data.get('successFlag')
                    if status_m == 1:
                        url_m = (p_data.get('response') or {}).get('resultImageUrl')
                    elif status_m in [2, 3]:
                        raise ValueError(f'Mockup generation failed (Status {status_m})')
                        
        # Poll Cutout if not yet done
        if not url_c:
            poll_c = requests.get(f"https://api.fluxapi.ai/api/v1/flux/kontext/record-info?taskId={task_id_c}", headers=headers)
            if poll_c.ok:
                pd_c = poll_c.json()
                if pd_c.get('code') == 200:
                    p_data_c = pd_c.get('data') or {}
                    status_c = p_data_c.get('successFlag')
                    if status_c == 1:
                        url_c = (p_data_c.get('response') or {}).get('resultImageUrl')
                    elif status_c in [2, 3]:
                        raise ValueError(f'Cutout generation failed (Status {status_c})')
                        
        # If both are done, break loop
        if url_m and url_c:
            break
            
    if not url_m or not url_c:
        raise ValueError('Flux API generation timed out (300s limit)')
        
    # Download images
    generated_dir = os.path.join(settings.MEDIA_ROOT, 'generated')
    os.makedirs(generated_dir, exist_ok=True)
    
    # Save Mockup
    img_m = requests.get(url_m)
    fn_m = f"flux_m_{uuid.uuid4().hex[:8]}.jpeg"
    with open(os.path.join(generated_dir, fn_m), 'wb') as f:
        f.write(img_m.content)
    final_m_url = f"{settings.MEDIA_URL}generated/{fn_m}"
    
    # Save Cutout
    img_c = requests.get(url_c)
    fn_c = f"flux_c_{uuid.uuid4().hex[:8]}.jpeg"
    with open(os.path.join(generated_dir, fn_c), 'wb') as f:
        f.write(img_c.content)
    final_c_url = f"{settings.MEDIA_URL}generated/{fn_c}"
    
    return final_m_url, final_c_url


@csrf_exempt
@role_required('Designer', 'Production', 'Admin')
def api_generate_mockups(request):
    if request.method == 'POST':
        try:
            data = json.loads(request.body)
            prompt_mockup = data.get('promptMockup')
            prompt_cutout = data.get('promptCutout')
            
            if not prompt_mockup or not prompt_cutout:
                return JsonResponse({'success': False, 'error': 'Both prompts are required'})
                
            final_m_url, final_c_url = _generate_flux_images(prompt_mockup, prompt_cutout)
            return JsonResponse({'success': True, 'mockup_url': final_m_url, 'cutout_url': final_c_url})
            
        except Exception as e:
            return JsonResponse({'success': False, 'error': str(e)})
    return JsonResponse({'success': False, 'error': 'Invalid request method'})