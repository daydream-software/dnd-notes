<#macro registrationLayout bodyClass="" displayInfo=false displayMessage=true displayRequiredFields=false>
<!DOCTYPE html>
<html class="${properties.kcHtmlClass!}" lang="${(locale.currentLanguageTag)!'en'}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex, nofollow">
  <title>${kcSanitize(msg("loginTitle",(realm.displayName!'')))?no_esc}</title>

  <#if properties.favIconUrl?has_content>
    <link rel="icon" href="${properties.favIconUrl}">
  </#if>

  <link rel="stylesheet" href="${url.resourcesPath}/css/login.css">

  <#if scripts??>
    <#list scripts as script>
      <script src="${script}" type="text/javascript"></script>
    </#list>
  </#if>
</head>

<body class="${properties.kcBodyClass!}">
<div id="kc-container" class="login-pf-page">
  <div id="kc-form-wrapper" class="card-pf">

    <#-- Brand header -->
    <div class="dnd-brand">
      <img
        src="${url.resourcesPath}/img/dnd-notes-mark.svg"
        alt=""
        class="dnd-brand-mark"
        aria-hidden="true"
      >
      <span class="dnd-brand-pill">D&amp;D NOTES</span>
      <#assign tenantName = (client.attributes['tenant_display_name']!'')>
      <#if tenantName?has_content>
      <p class="dnd-signin-heading">Sign in to ${tenantName?html}</p>
      <#else>
      <p class="dnd-signin-heading">Sign in to D&amp;D Notes</p>
      </#if>
    </div>

    <#-- Flash messages -->
    <#if displayMessage && message?has_content && (message.type != 'warning' || !isAppInitiatedAction??)>
      <div class="alert alert-${message.type}">
        ${kcSanitize(message.summary)?no_esc}
      </div>
    </#if>

    <#-- Page body -->
    <#nested "form">

    <#-- Info section (e.g. "code sent to your email") -->
    <#if displayInfo>
      <div id="kc-info">
        <#nested "info">
      </div>
    </#if>

  </div>
</div>
</body>
</html>
</#macro>
