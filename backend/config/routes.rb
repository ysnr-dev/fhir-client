Rails.application.routes.draw do
  scope "fhir", format: false do
    get "metadata", to: "fhir_proxy#relay", defaults: { fhir_path: "metadata" }
    match "*fhir_path", to: "fhir_proxy#relay", via: %i[get post put delete]
  end
end
