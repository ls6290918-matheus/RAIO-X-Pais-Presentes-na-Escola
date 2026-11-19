# E-mails do login (Supabase → Authentication → Emails → Templates)

Cole o **Assunto** e o **Corpo** de cada modelo. Não apague as partes entre `{{ }}`: o Supabase troca pelo link certo.

---

## Confirm signup (confirmar cadastro)

**Assunto:** Confirme seu cadastro no Limpa Aqui

```html
<div style="font-family:Arial,Helvetica,sans-serif;max-width:480px;margin:0 auto;color:#1f2a30">
  <h2 style="color:#0f3b45">Bem-vindo ao Limpa Aqui!</h2>
  <p>Falta só um passo: confirme o seu e-mail para ativar a sua conta.</p>
  <p style="margin:28px 0">
    <a href="{{ .ConfirmationURL }}" style="background:#5ed6c0;color:#0f3b45;padding:12px 22px;border-radius:10px;text-decoration:none;font-weight:bold">Confirmar meu e-mail</a>
  </p>
  <p style="font-size:13px;color:#5b6b72">Se você não criou uma conta no Limpa Aqui, ignore este e-mail.</p>
</div>
```

## Reset password (recuperar senha)

**Assunto:** Crie uma nova senha no Limpa Aqui

```html
<div style="font-family:Arial,Helvetica,sans-serif;max-width:480px;margin:0 auto;color:#1f2a30">
  <h2 style="color:#0f3b45">Nova senha</h2>
  <p>Recebemos um pedido para trocar a senha da sua conta. Toque no botão para criar uma nova:</p>
  <p style="margin:28px 0">
    <a href="{{ .ConfirmationURL }}" style="background:#5ed6c0;color:#0f3b45;padding:12px 22px;border-radius:10px;text-decoration:none;font-weight:bold">Criar nova senha</a>
  </p>
  <p style="font-size:13px;color:#5b6b72">Se não foi você, ignore este e-mail: a sua senha continua a mesma.</p>
</div>
```

## Magic link (link de acesso)

**Assunto:** Seu link para entrar no Limpa Aqui

```html
<div style="font-family:Arial,Helvetica,sans-serif;max-width:480px;margin:0 auto;color:#1f2a30">
  <h2 style="color:#0f3b45">Entrar no Limpa Aqui</h2>
  <p style="margin:28px 0">
    <a href="{{ .ConfirmationURL }}" style="background:#5ed6c0;color:#0f3b45;padding:12px 22px;border-radius:10px;text-decoration:none;font-weight:bold">Entrar</a>
  </p>
  <p style="font-size:13px;color:#5b6b72">Se você não pediu este link, ignore este e-mail.</p>
</div>
```

## Change email address (trocar e-mail)

**Assunto:** Confirme o seu novo e-mail no Limpa Aqui

```html
<div style="font-family:Arial,Helvetica,sans-serif;max-width:480px;margin:0 auto;color:#1f2a30">
  <h2 style="color:#0f3b45">Confirme o novo e-mail</h2>
  <p>Você pediu para trocar o e-mail da sua conta de <strong>{{ .Email }}</strong> para <strong>{{ .NewEmail }}</strong>.</p>
  <p style="margin:28px 0">
    <a href="{{ .ConfirmationURL }}" style="background:#5ed6c0;color:#0f3b45;padding:12px 22px;border-radius:10px;text-decoration:none;font-weight:bold">Confirmar troca</a>
  </p>
</div>
```

## Invite user (convite)

**Assunto:** Você foi convidado para o Limpa Aqui

```html
<div style="font-family:Arial,Helvetica,sans-serif;max-width:480px;margin:0 auto;color:#1f2a30">
  <h2 style="color:#0f3b45">Você foi convidado!</h2>
  <p>Toque no botão para criar a sua conta no Limpa Aqui:</p>
  <p style="margin:28px 0">
    <a href="{{ .ConfirmationURL }}" style="background:#5ed6c0;color:#0f3b45;padding:12px 22px;border-radius:10px;text-decoration:none;font-weight:bold">Aceitar convite</a>
  </p>
</div>
```
