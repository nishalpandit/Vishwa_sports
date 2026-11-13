from django.db import models
from django.contrib.auth.models import User
from django.db.models.signals import post_save
from django.dispatch import receiver

from django.utils import timezone
import datetime
import uuid

class UserProfile(models.Model):
    ROLE_CHOICES = [
        ('Admin', 'Admin'),
        ('Designer', 'Designer'),
        ('Production', 'Production'),
        ('User', 'User'),
        ('Client', 'Client'),
    ]
    STATUS_CHOICES = [
        ('Active', 'Active'),
        ('Inactive', 'Inactive'),
    ]
    user = models.OneToOneField(User, on_delete=models.CASCADE, related_name='profile')
    role = models.CharField(max_length=20, choices=ROLE_CHOICES, default='Designer')
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='Active')
    phone = models.CharField(max_length=20, unique=True, null=True, blank=True)
    api_token = models.CharField(max_length=100, unique=True, null=True, blank=True, db_index=True)

    def generate_bearer_token(self, force_new=False):
        if not self.api_token or force_new:
            self.api_token = f"{uuid.uuid4().hex}{uuid.uuid4().hex}"
            self.save(update_fields=['api_token'])
        return self.api_token

    def get_or_create_token(self, force_new=False):
        return self.generate_bearer_token(force_new=force_new)

    def __str__(self):
        return f"{self.user.username} ({self.role} - {self.status})"


class OTPVerification(models.Model):
    phone = models.CharField(max_length=20, db_index=True)
    otp = models.CharField(max_length=10)
    created_at = models.DateTimeField(auto_now_add=True)
    is_used = models.BooleanField(default=False)
    action = models.CharField(max_length=20, default='login')

    def is_valid(self):
        if self.is_used:
            return False
        # 5 minutes expiration window
        elapsed = timezone.now() - self.created_at
        return elapsed < datetime.timedelta(minutes=5)

    def __str__(self):
        return f"{self.phone} - {self.otp} ({self.action})"

@receiver(post_save, sender=User)
def create_or_update_user_profile(sender, instance, created, **kwargs):
    if created:
        role = 'Admin' if instance.is_superuser else 'Designer'
        UserProfile.objects.create(user=instance, role=role, status='Active')
    else:
        UserProfile.objects.get_or_create(
            user=instance,
            defaults={'role': 'Admin' if instance.is_superuser else 'Designer', 'status': 'Active'}
        )


class MasterJerseyType(models.Model):
    name = models.CharField(max_length=100, unique=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['id']

    def __str__(self):
        return self.name


class MasterSize(models.Model):
    name = models.CharField(max_length=50, unique=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['id']

    def __str__(self):
        return self.name


class ProductCatalog(models.Model):
    STATUS_CHOICES = [
        ('Active', 'Active'),
        ('Inactive', 'Inactive'),
    ]
    ORDER_STATUS_CHOICES = [
        ('new', 'New'),
        ('design_in_progress', 'Design In Progress'),
        ('awaiting_approval', 'Awaiting Approval'),
        ('approved', 'Approved'),
        ('declined', 'Declined'),
        ('qty_pending', 'Qty Pending'),
        ('in_production', 'In Production'),
        ('qc', 'Quality Check'),
        ('ready_for_payment', 'Ready for Payment'),
        ('paid', 'Paid'),
        ('shipped', 'Shipped'),
    ]
    jersey_type = models.CharField(max_length=150)
    available_sizes = models.JSONField(default=list, help_text='List of available sizes e.g. ["S","M","L"]')
    on_jersey_name = models.CharField(max_length=100, default='CUSTOM')
    on_jersey_number = models.CharField(max_length=10, default='00')
    logo = models.ImageField(upload_to='products/logos/', null=True, blank=True)
    design = models.ImageField(upload_to='products/designs/', null=True, blank=True)
    mockup = models.ImageField(upload_to='products/mockups/', null=True, blank=True)
    cutout = models.ImageField(upload_to='products/cutouts/', null=True, blank=True)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='Active')
    order_status = models.CharField(max_length=30, choices=ORDER_STATUS_CHOICES, default='new')
    unit_price = models.DecimalField(max_digits=10, decimal_places=2, default=0.00)
    history = models.JSONField(default=list, blank=True)
    created_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True, related_name='created_products')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at']

    @property
    def logo_filename(self):
        return self.logo.name.split('/')[-1] if self.logo and getattr(self.logo, 'name', None) else 'No logo'

    @property
    def design_filename(self):
        return self.design.name.split('/')[-1] if self.design and getattr(self.design, 'name', None) else 'No design'

    @property
    def mockup_filename(self):
        return self.mockup.name.split('/')[-1] if hasattr(self, 'mockup') and self.mockup and getattr(self.mockup, 'name', None) else 'No mockup'

    def __str__(self):
        return f"{self.jersey_type} - {self.on_jersey_name} #{self.on_jersey_number}"


# ==========================================
# DESIGNER DASHBOARD SPECIFICATION MODELS
# ==========================================

class Customer(models.Model):
    customer_id = models.CharField(max_length=50, unique=True, default=uuid.uuid4)
    name = models.CharField(max_length=200)
    email = models.EmailField(blank=True, null=True)
    phone = models.CharField(max_length=20, blank=True, null=True)
    team_name = models.CharField(max_length=200, blank=True, null=True)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"{self.name} ({self.team_name})"

class Order(models.Model):
    order_id = models.CharField(max_length=50, unique=True, default=uuid.uuid4)
    customer = models.ForeignKey(Customer, on_delete=models.CASCADE, related_name='orders')
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return self.order_id

class JerseyDesign(models.Model):
    design_id = models.CharField(max_length=50, unique=True, default=uuid.uuid4)
    order = models.ForeignKey(Order, on_delete=models.CASCADE, related_name='designs')
    designer = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name='assigned_designs')
    created_at = models.DateTimeField(auto_now_add=True)
    
    def __str__(self):
        return f"Design {self.design_id} - Order {self.order.order_id}"

class JerseyDesignVersion(models.Model):
    STATUS_CHOICES = [
        ('DRAFT', 'Draft'),
        ('DESIGN_CREATED', 'Design Created'),
        ('MOCKUP_GENERATED', 'Mockup Generated'),
        ('SENT_TO_CUSTOMER', 'Sent to Customer'),
        ('CUSTOMER_REVIEW', 'Customer Review'),
        ('CHANGES_REQUESTED', 'Changes Requested'),
        ('DESIGN_REVISION', 'Design Revision'),
        ('SENT_FOR_APPROVAL', 'Sent for Approval'),
        ('CUSTOMER_APPROVED', 'Customer Approved'),
        ('CUTOUT_GENERATED', 'Cutout Generated'),
        ('CUTOUT_VALIDATED', 'Cutout Validated'),
        ('SENT_TO_PRODUCTION', 'Sent to Production'),
    ]
    
    design = models.ForeignKey(JerseyDesign, on_delete=models.CASCADE, related_name='versions')
    version_number = models.IntegerField(default=1)
    status = models.CharField(max_length=50, choices=STATUS_CHOICES, default='DRAFT')
    is_locked = models.BooleanField(default=False)
    
    # Assets
    jersey_type = models.CharField(max_length=150)
    flat_design = models.ImageField(upload_to='designs/flat/', null=True, blank=True)
    logo = models.ImageField(upload_to='designs/logos/', null=True, blank=True)
    on_jersey_name = models.CharField(max_length=100, default='CUSTOM')
    on_jersey_number = models.CharField(max_length=10, default='00')
    size = models.CharField(max_length=20)
    quantity = models.IntegerField(default=10) # Minimum 10
    
    # Pricing
    unit_price = models.DecimalField(max_digits=10, decimal_places=2, default=0.00)
    
    created_at = models.DateTimeField(auto_now_add=True)
    
    class Meta:
        unique_together = ('design', 'version_number')
        ordering = ['-version_number']

    def __str__(self):
        return f"{self.design.design_id} - V{self.version_number} ({self.status})"

class MockupJob(models.Model):
    version = models.ForeignKey(JerseyDesignVersion, on_delete=models.CASCADE, related_name='mockups')
    mockup_image = models.ImageField(upload_to='mockups/generated/', null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

class CutoutJob(models.Model):
    version = models.ForeignKey(JerseyDesignVersion, on_delete=models.CASCADE, related_name='cutouts')
    cutout_file = models.FileField(upload_to='cutouts/', null=True, blank=True)
    is_validated = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

class ProductionOrder(models.Model):
    PRODUCTION_STATUS = [
        ('PRODUCTION_RECEIVED', 'Production Received'),
        ('PRODUCTION_ACCEPTED', 'Production Accepted'),
        ('CUTTING', 'Cutting'),
        ('PRINTING', 'Printing'),
        ('STITCHING', 'Stitching'),
        ('QUALITY_CHECK', 'Quality Check'),
        ('PRODUCTION_COMPLETED', 'Production Completed'),
        ('READY_FOR_DELIVERY', 'Ready for Delivery'),
        ('COMPLETED', 'Completed'),
    ]
    version = models.OneToOneField(JerseyDesignVersion, on_delete=models.CASCADE, related_name='production_order')
    status = models.CharField(max_length=50, choices=PRODUCTION_STATUS, default='PRODUCTION_RECEIVED')
    accepted_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name='accepted_production')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"Prod for {self.version.design.design_id} V{self.version.version_number}"
