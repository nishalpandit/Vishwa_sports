from django.contrib import admin
from .models import (
    UserProfile, OTPVerification, MasterJerseyType, MasterSize, ProductCatalog,
    Customer, Order, JerseyDesign, JerseyDesignVersion, MockupJob, CutoutJob, ProductionOrder
)

admin.site.register(UserProfile)
admin.site.register(OTPVerification)
admin.site.register(MasterJerseyType)
admin.site.register(MasterSize)
admin.site.register(ProductCatalog)
admin.site.register(Customer)
admin.site.register(Order)
admin.site.register(JerseyDesign)
admin.site.register(JerseyDesignVersion)
admin.site.register(MockupJob)
admin.site.register(CutoutJob)
admin.site.register(ProductionOrder)
