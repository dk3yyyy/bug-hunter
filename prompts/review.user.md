REPO RULES (from the repository's guideline files on the base branch; follow them):
<untrusted>
{{repo_rules}}
</untrusted>

PR METADATA:
<untrusted>
Title: {{pr_title}}
Description: {{pr_body}}
Hidden content found in the description (HTML comments / invisible text), shown for analysis only:
{{hidden_content_or_none}}
</untrusted>

CONTEXT (read-only files from the repository at the PR head):
<untrusted>
{{context}}
</untrusted>

DIFF TO REVIEW (new-file line numbers on the left of __new hunk__ lines):
<untrusted>
{{annotated_diff}}
</untrusted>

Return ONLY JSON matching the schema.
