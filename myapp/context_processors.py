from .models import UserProfile, ProductCatalog

def user_profile_context(request):
    """
    Exposes user metadata and active products directly to all server-rendered Django HTML templates.
    """
    products = ProductCatalog.objects.filter(status='Active')
    
    if hasattr(request, 'user') and request.user.is_authenticated:
        name = request.user.first_name or request.user.username
        initial = name[0].upper() if name else "U"
        role = "Staff"
        try:
            role = request.user.userprofile.role
        except Exception:
            pass
        return {
            'current_user_name': name,
            'current_user_initial': initial,
            'current_user_role': role,
            'products': products,
        }
    return {
        'current_user_name': 'Guest',
        'current_user_initial': 'G',
        'current_user_role': 'Guest',
        'products': products,
    }
