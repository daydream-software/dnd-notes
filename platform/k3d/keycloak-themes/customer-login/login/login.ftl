<#import "template.ftl" as layout>
<@layout.registrationLayout displayMessage=!messagesPerField.existsError('username','password') displayInfo=realm.password && realm.registrationAllowed && !registrationDisabled??; section>
  <#if section = "form">

    <form id="kc-form-login" onsubmit="login.disabled = true; return true;" action="${url.loginAction}" method="post">

      <#-- Username / email -->
      <div class="form-group">
        <label for="username">
          <#if !realm.loginWithEmailAllowed>
            ${msg("username")}
          <#elseif !realm.registrationEmailAsUsername>
            ${msg("usernameOrEmail")}
          <#else>
            ${msg("email")}
          </#if>
        </label>
        <input
          id="username"
          name="username"
          type="text"
          autocomplete="username"
          autofocus
          value="${(login.username!'')?html}"
          tabindex="1"
        >
        <#if messagesPerField.existsError('username','password')>
          <div class="alert alert-error">
            ${kcSanitize(messagesPerField.getFirstError('username','password'))?no_esc}
          </div>
        </#if>
      </div>

      <#-- Password -->
      <div class="form-group">
        <label for="password">${msg("password")}</label>
        <div class="pf-c-input-group">
          <input
            id="password"
            name="password"
            type="password"
            autocomplete="current-password"
            tabindex="2"
          >
        </div>
      </div>

      <#-- Options: remember me + forgot password -->
      <div id="kc-form-options">
        <#if realm.rememberMe && !usernameEditDisabled??>
          <div class="checkbox">
            <label>
              <input
                type="checkbox"
                id="rememberMe"
                name="rememberMe"
                tabindex="3"
                <#if login.rememberMe??>checked</#if>
              >
              ${msg("rememberMe")}
            </label>
          </div>
        </#if>

        <#if realm.resetPasswordAllowed>
          <a href="${url.loginResetCredentialsUrl}" tabindex="5">
            ${msg("doForgotPassword")}
          </a>
        </#if>
      </div>

      <#-- Submit -->
      <div id="kc-form-buttons">
        <input
          type="hidden"
          id="id-hidden-input"
          name="credentialId"
          <#if auth.selectedCredential?has_content>value="${auth.selectedCredential}"</#if>
        >
        <button
          type="submit"
          id="kc-login"
          name="login"
          tabindex="4"
        >${msg("doLogIn")}</button>
      </div>

    </form>

  <#elseif section = "info">
    <#if realm.password && realm.registrationAllowed && !registrationDisabled??>
      <div id="kc-registration">
        <span>${msg("noAccount")} <a href="${url.registrationUrl}" tabindex="6">${msg("doRegister")}</a></span>
      </div>
    </#if>
  </#if>
</@layout.registrationLayout>
