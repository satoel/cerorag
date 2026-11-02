# Module for provider `azurerm`. Resources are added in the phase that owns them
# (see the phase plan); provider configuration lands together with the first resource.
terraform {
  required_version = "~> 1.13"

  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 5.12"
    }
  }
}
