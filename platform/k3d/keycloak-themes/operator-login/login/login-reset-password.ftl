<#import "template.ftl" as layout>
<@layout.registrationLayout displayInfo=true displayMessage=!messagesPerField.existsError('username'); section>
  <#if section = "form">

    <form id="kc-reset-password-form" action="${url.loginAction}" method="post">

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
          value="${(auth.attemptedUsername!'')}"
        >
        <#if messagesPerField.existsError('username')>
          <div class="alert alert-error">
            ${kcSanitize(messagesPerField.getFirstError('username'))?no_esc}
          </div>
        </#if>
      </div>

      <div id="kc-form-buttons" style="display:flex; gap: 10px; align-items: center; flex-wrap: wrap;">
        <button type="submit">${msg("doSubmit")}</button>
        <a href="${url.loginUrl}">${msg("backToLogin")}</a>
      </div>

    </form>

  <#elseif section = "info">
    ${msg("emailInstruction")}
  </#if>
</@layout.registrationLayout>
