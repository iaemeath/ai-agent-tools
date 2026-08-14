<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { Plus, Pencil, Delete, Link, Unlink } from 'lucide-vue-next';
import { useI18n } from 'vue-i18n';
import { api, type HostSummary, type HostInput } from '../api';

const { t } = useI18n();
const hosts = ref<HostSummary[]>([]);
const loading = ref(false);

async function load() {
	loading.value = true;
	try {
		const { hosts: list } = await api.listHosts();
		hosts.value = list;
	} catch (e) {
		ElMessage.error((e as Error).message);
	} finally {
		loading.value = false;
	}
}
onMounted(load);

// ---- Form dialog (add / edit) ----
const dialogVisible = ref(false);
const editingId = ref<string | null>(null);
const saving = ref(false);
const testing = ref(false);
const form = ref<HostInput>(emptyForm());

function emptyForm(): HostInput {
	return { name: '', host: '', port: 22, userName: '', authMethod: 'password', password: '', privateKeyPath: '', passphrase: '' };
}

function openAdd() {
	editingId.value = null;
	form.value = emptyForm();
	dialogVisible.value = true;
}

function openEdit(h: HostSummary) {
	editingId.value = h.id;
	form.value = {
		id: h.id,
		name: h.name,
		host: h.host,
		port: h.port,
		userName: h.userName,
		authMethod: h.authMethod,
		password: '', // left blank → keep stored secret
		privateKeyPath: h.privateKeyPath ?? '',
		passphrase: '',
	};
	dialogVisible.value = true;
}

async function testFromForm() {
	if (!form.value.host || !form.value.userName) {
		ElMessage.warning(t('host.host') + ' / ' + t('host.userName'));
		return;
	}
	testing.value = true;
	try {
		// On edit with blank password, we cannot test stored creds from the client (they're
		// encrypted server-side); tell the user to enter the secret to test.
		if (editingId.value && !form.value.password && !form.value.passphrase && form.value.authMethod === 'password') {
			ElMessage.info(t('host.passwordKeep'));
		}
		const res = await api.testHost({
			host: form.value.host,
			port: form.value.port,
			userName: form.value.userName,
			authMethod: form.value.authMethod,
			password: form.value.password,
			privateKeyPath: form.value.privateKeyPath,
			passphrase: form.value.passphrase,
		});
		if (res.ok) ElMessage.success(`${t('host.testOk')}${res.homeDir ? ` · ${res.homeDir}` : ''}`);
		else ElMessage.error(`${t('host.testFail')}: ${res.error ?? ''}`);
	} catch (e) {
		ElMessage.error((e as Error).message);
	} finally {
		testing.value = false;
	}
}

async function save() {
	if (!form.value.name || !form.value.host || !form.value.userName) {
		ElMessage.warning(`${t('host.name')} / ${t('host.host')} / ${t('host.userName')}`);
		return;
	}
	saving.value = true;
	try {
		// Editing + blank secret fields → omit them so the server keeps the stored value.
		const body: HostInput = { ...form.value };
		if (editingId.value && !body.password) delete body.password;
		if (editingId.value && !body.passphrase) delete body.passphrase;
		await api.saveHost(body);
		ElMessage.success(t('host.saved'));
		dialogVisible.value = false;
		await load();
		window.dispatchEvent(new CustomEvent('ccc-ui:hosts-changed'));
	} catch (e) {
		ElMessage.error((e as Error).message);
	} finally {
		saving.value = false;
	}
}

async function remove(h: HostSummary) {
	try {
		await ElMessageBox.confirm(t('host.deleteConfirm'), { type: 'warning', confirmButtonText: t('host.delete'), cancelButtonText: t('host.edit') === 'Edit' ? 'Cancel' : '取消' });
	} catch {
		return;
	}
	try {
		await api.deleteHost(h.id);
		await load();
		window.dispatchEvent(new CustomEvent('ccc-ui:hosts-changed'));
	} catch (e) {
		ElMessage.error((e as Error).message);
	}
}

async function disconnect(h: HostSummary) {
	try {
		await api.disconnectHost(h.id);
		await load();
	} catch (e) {
		ElMessage.error((e as Error).message);
	}
}

function statusType(s: HostSummary['status']): 'success' | 'warning' | 'info' {
	return s === 'connected' ? 'success' : s === 'connecting' ? 'warning' : 'info';
}
function statusKey(s: HostSummary['status']): string {
	return { connected: 'host.statusConnected', connecting: 'host.statusConnecting', idle: 'host.statusIdle' }[s];
}
function authLabel(a: 'password' | 'privateKey'): string {
	return a === 'password' ? t('host.authPassword') : t('host.authPrivateKey');
}
</script>

<template>
  <div class="hosts-view">
    <div class="toolbar">
      <el-button type="primary" :icon="Plus" @click="openAdd">{{ t('host.add') }}</el-button>
      <span class="hint">{{ t('host.hint') }}</span>
    </div>

    <el-table :data="hosts" v-loading="loading" empty-text="" style="width: 100%">
      <template #empty>
        <div class="empty">{{ t('host.empty') }}</div>
      </template>
      <el-table-column :label="t('host.name')" prop="name" min-width="120" />
      <el-table-column :label="t('host.host')" min-width="180">
        <template #default="{ row }">{{ row.host }}:{{ row.port }}</template>
      </el-table-column>
      <el-table-column :label="t('host.userName')" prop="userName" min-width="100" />
      <el-table-column :label="t('host.authMethod')" min-width="100">
        <template #default="{ row }">{{ authLabel(row.authMethod) }}</template>
      </el-table-column>
      <el-table-column :label="t('host.colStatus')" min-width="100">
        <template #default="{ row }">
          <el-tag :type="statusType(row.status)" size="small">{{ t(statusKey(row.status)) }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column :label="t('host.colActions')" width="200">
        <template #default="{ row }">
          <el-button text :icon="Pencil" @click="openEdit(row)">{{ t('host.edit') }}</el-button>
          <el-button v-if="row.status === 'connected'" text :icon="Unlink" @click="disconnect(row)">{{ t('host.disconnect') }}</el-button>
          <el-button text type="danger" :icon="Delete" @click="remove(row)">{{ t('host.delete') }}</el-button>
        </template>
      </el-table-column>
    </el-table>

    <el-dialog v-model="dialogVisible" :title="editingId ? t('host.edit') : t('host.add')" width="520px">
      <el-form :model="form" label-width="120px" label-position="right">
        <el-form-item :label="t('host.name')"><el-input v-model="form.name" /></el-form-item>
        <el-form-item :label="t('host.host')"><el-input v-model="form.host" placeholder="192.168.1.10" /></el-form-item>
        <el-form-item :label="t('host.port')"><el-input-number v-model="form.port" :min="1" :max="65535" controls-position="right" /></el-form-item>
        <el-form-item :label="t('host.userName')"><el-input v-model="form.userName" /></el-form-item>
        <el-form-item :label="t('host.authMethod')">
          <el-radio-group v-model="form.authMethod">
            <el-radio value="password">{{ t('host.authPassword') }}</el-radio>
            <el-radio value="privateKey">{{ t('host.authPrivateKey') }}</el-radio>
          </el-radio-group>
        </el-form-item>
        <template v-if="form.authMethod === 'password'">
          <el-form-item :label="t('host.authPassword')">
            <el-input v-model="form.password" type="password" show-password :placeholder="editingId ? t('host.passwordKeep') : ''" />
          </el-form-item>
        </template>
        <template v-else>
          <el-form-item :label="t('host.authPrivateKey')">
            <el-input v-model="form.privateKeyPath" placeholder="C:\\Users\\you\\.ssh\\id_rsa" />
          </el-form-item>
          <el-form-item :label="t('host.passphrase')">
            <el-input v-model="form.passphrase" type="password" show-password :placeholder="editingId ? t('host.passwordKeep') : ''" />
          </el-form-item>
        </template>
      </el-form>
      <template #footer>
        <el-button :loading="testing" :icon="Link" @click="testFromForm">{{ t('host.test') }}</el-button>
        <el-button @click="dialogVisible = false">{{ t('rule.cancel') }}</el-button>
        <el-button type="primary" :loading="saving" @click="save">{{ t('rule.save') }}</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.hosts-view {
  padding: 16px 24px;
}
.toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 16px;
}
.hint {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
.empty {
  padding: 40px 0;
  color: var(--el-text-color-secondary);
}
</style>
